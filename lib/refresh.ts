import { db, schema } from "@/lib/db/client";
import { and, eq } from "drizzle-orm";
import { decrypt } from "@/lib/crypto/encrypt";
import { fetchBinanceBalances } from "@/lib/integrations/binance";
import { fetchOkxBalances } from "@/lib/integrations/okx";
import { fetchEthHoldings } from "@/lib/integrations/eth";
import { getCryptoPricesUsd } from "@/lib/integrations/coingecko";
import { fetchBinanceUsdPrices } from "@/lib/integrations/binance-prices";
import { fetchOkxUsdPrices } from "@/lib/integrations/okx-prices";
import { getFxToMad, toMad } from "@/lib/integrations/fx";
import { fetchMetalsUsdPerOz, type MetalSymbol } from "@/lib/integrations/metals";
import { assetValueMad } from "@/lib/assets/value";
import type { RawBalance } from "@/lib/integrations/binance";

type SourceType = "binance" | "okx" | "eth";

type SourceJob = {
  sourceType: SourceType;
  sourceId: number;
  fetch: () => Promise<RawBalance[]>;
  recordError: (err: string | null) => Promise<void>;
};

async function loadJobs(): Promise<SourceJob[]> {
  const jobs: SourceJob[] = [];

  const exchanges = await db.select().from(schema.exchangeAccounts);
  for (const ex of exchanges) {
    if (ex.exchange === "binance") {
      jobs.push({
        sourceType: "binance",
        sourceId: ex.id,
        fetch: async () => {
          const [apiKey, apiSecret] = await Promise.all([
            decrypt(ex.apiKeyEnc),
            decrypt(ex.apiSecretEnc),
          ]);
          return fetchBinanceBalances(apiKey, apiSecret);
        },
        recordError: async (err) => {
          await db
            .update(schema.exchangeAccounts)
            .set({
              lastError: err,
              lastSyncedAt: err ? ex.lastSyncedAt : new Date().toISOString(),
            })
            .where(eq(schema.exchangeAccounts.id, ex.id));
        },
      });
    } else if (ex.exchange === "okx") {
      jobs.push({
        sourceType: "okx",
        sourceId: ex.id,
        fetch: async () => {
          const [apiKey, apiSecret, passphrase] = await Promise.all([
            decrypt(ex.apiKeyEnc),
            decrypt(ex.apiSecretEnc),
            ex.passphraseEnc ? decrypt(ex.passphraseEnc) : Promise.resolve(""),
          ]);
          return fetchOkxBalances(apiKey, apiSecret, passphrase);
        },
        recordError: async (err) => {
          await db
            .update(schema.exchangeAccounts)
            .set({
              lastError: err,
              lastSyncedAt: err ? ex.lastSyncedAt : new Date().toISOString(),
            })
            .where(eq(schema.exchangeAccounts.id, ex.id));
        },
      });
    }
  }

  const wallets = await db.select().from(schema.ethWallets);
  for (const w of wallets) {
    jobs.push({
      sourceType: "eth",
      sourceId: w.id,
      fetch: () => fetchEthHoldings(w.address),
      recordError: async (err) => {
        await db
          .update(schema.ethWallets)
          .set({
            lastError: err,
            lastSyncedAt: err ? w.lastSyncedAt : new Date().toISOString(),
          })
          .where(eq(schema.ethWallets.id, w.id));
      },
    });
  }

  return jobs;
}

export async function refreshAll(): Promise<{
  successes: number;
  failures: number;
  totalMad: number;
}> {
  const jobs = await loadJobs();

  const results = await Promise.allSettled(
    jobs.map(async (j) => ({ job: j, balances: await j.fetch() })),
  );

  type Pulled = { job: SourceJob; balances: RawBalance[] };
  const pulled: Pulled[] = [];
  let failures = 0;

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const job = jobs[i];
    if (r.status === "fulfilled") {
      await job.recordError(null);
      pulled.push(r.value);
    } else {
      failures++;
      const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
      await job.recordError(msg.slice(0, 500));
    }
  }

  const allSymbols = new Set<string>();
  for (const { balances } of pulled) for (const b of balances) allSymbols.add(b.asset);

  const [binancePricesResult, okxPricesResult, cgPrices, fx] = await Promise.all([
    fetchBinanceUsdPrices().catch(() => ({}) as Record<string, number>),
    fetchOkxUsdPrices().catch(() => ({}) as Record<string, number>),
    getCryptoPricesUsd(Array.from(allSymbols)),
    getFxToMad(true),
  ]);
  const prices: Record<string, number> = { ...cgPrices };
  for (const [sym, price] of Object.entries(okxPricesResult)) {
    if (price > 0) prices[sym] = price;
  }
  for (const [sym, price] of Object.entries(binancePricesResult)) {
    if (price > 0) prices[sym] = price;
  }
  const usdToMad = fx["USD"] ?? 0;

  for (const { job, balances } of pulled) {
    await db
      .delete(schema.holdingsCache)
      .where(
        and(
          eq(schema.holdingsCache.sourceType, job.sourceType),
          eq(schema.holdingsCache.sourceId, job.sourceId),
        ),
      );
    if (balances.length) {
      await db.insert(schema.holdingsCache).values(
        balances.map((b) => {
          const priceUsd = prices[b.asset.toUpperCase()] ?? 0;
          const valueMad = b.amount * priceUsd * usdToMad;
          return {
            sourceType: job.sourceType,
            sourceId: job.sourceId,
            assetSymbol: b.asset,
            amount: b.amount,
            priceUsd,
            valueMad,
          };
        }),
      );
    }
  }

  // Refresh metal spot prices on any precious-metal asset rows.
  try {
    const metalPrices = await fetchMetalsUsdPerOz(true);
    const now = new Date().toISOString();
    for (const metal of Object.keys(metalPrices) as MetalSymbol[]) {
      const price = metalPrices[metal];
      if (!price) continue;
      await db
        .update(schema.assets)
        .set({ pricePerOzUsd: price, lastPricedAt: now })
        .where(eq(schema.assets.metal, metal));
    }
  } catch (e) {
    console.error("metal price refresh failed", e);
  }

  const totals = await computeNetWorth();
  await db.insert(schema.netWorthSnapshots).values({
    totalMad: totals.totalMad,
    breakdownJson: JSON.stringify(totals.breakdown),
  });

  return { successes: pulled.length, failures, totalMad: totals.totalMad };
}

export type Breakdown = {
  banksMad: number;
  banksAed: number;
  banksOther: number;
  cash: number;
  exchanges: number;
  ethWallets: number;
  assets: number;
  income: number;
  expensesThisMonth: number;
  debtsIOwe: number;
  debtsOwedToMe: number;
};

export async function computeNetWorth(): Promise<{
  totalMad: number;
  breakdown: Breakdown;
}> {
  const fx = await getFxToMad();

  const banks = await db.select().from(schema.bankAccounts);
  let banksMad = 0;
  let banksAed = 0;
  let banksOther = 0;
  for (const b of banks) {
    if (b.currency === "MAD") banksMad += b.balance;
    else if (b.currency === "AED") banksAed += toMad(b.balance, "AED", fx);
    else banksOther += toMad(b.balance, b.currency, fx);
  }

  const cashRows = await db.select().from(schema.cashHoldings);
  const cash = cashRows.reduce((s, c) => s + toMad(c.amount, c.currency, fx), 0);

  const holdings = await db.select().from(schema.holdingsCache);
  let exchanges = 0;
  let ethWallets = 0;
  for (const h of holdings) {
    if (h.sourceType === "eth") ethWallets += h.valueMad;
    else exchanges += h.valueMad;
  }

  const assetRows = await db.select().from(schema.assets);
  const assets = assetRows.reduce((s, a) => s + assetValueMad(a, fx), 0);

  const debts = await db
    .select()
    .from(schema.debts)
    .where(eq(schema.debts.status, "open"));
  let debtsIOwe = 0;
  let debtsOwedToMe = 0;
  for (const d of debts) {
    const mad = toMad(d.amount, d.currency, fx);
    if (d.direction === "i_owe") debtsIOwe += mad;
    else debtsOwedToMe += mad;
  }

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    .toISOString()
    .slice(0, 10);
  const expensesAll = await db.select().from(schema.expenses);
  const expensesThisMonth = expensesAll
    .filter((e) => e.occurredOn >= monthStart)
    .reduce((s, e) => s + toMad(e.amount, e.currency, fx), 0);

  const incomesAll = await db.select().from(schema.incomes);
  const income = incomesAll
    .filter((i) => i.occurredOn >= monthStart)
    .reduce((s, i) => s + toMad(i.amount, i.currency, fx), 0);

  const totalMad =
    banksMad +
    banksAed +
    banksOther +
    cash +
    exchanges +
    ethWallets +
    assets +
    debtsOwedToMe -
    debtsIOwe;

  return {
    totalMad,
    breakdown: {
      banksMad,
      banksAed,
      banksOther,
      cash,
      exchanges,
      ethWallets,
      assets,
      income,
      expensesThisMonth,
      debtsIOwe,
      debtsOwedToMe,
    },
  };
}
