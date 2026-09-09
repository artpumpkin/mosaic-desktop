"use client";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { fmtBase, fmtDateTime, type FxTable } from "@/lib/format";
import { getFxToMad } from "@/lib/integrations/fx";
import { getBaseCurrency, getAlchemyApiKey, type BaseCurrency } from "@/lib/settings";
import { useFinanceData } from "@/lib/query/useFinanceData";
import { useWide } from "@/lib/appLayout";
import GlassCard from "@/components/GlassCard";
import PageHeader from "@/components/PageHeader";
import PageSkeleton from "@/components/PageSkeleton";
import RefreshButton from "@/components/RefreshButton";
import EmptyState from "@/components/EmptyState";
import ErrorCard from "@/components/ErrorCard";
import AssetsTable from "@/components/AssetsTable";
import Sensitive from "@/components/Sensitive";
import {
  WalletCreateForm,
  WalletDeleteForm,
} from "@/components/forms/WalletForms";
import { Coins, AlertTriangle } from "lucide-react";

type Wallet = typeof schema.ethWallets.$inferSelect;
type Holding = typeof schema.holdingsCache.$inferSelect;
type PageData = {
  wallets: Wallet[];
  holdings: Holding[];
  fx: FxTable;
  base: BaseCurrency;
  alchemyConfigured: boolean;
  fxStale: boolean;
};

async function load(): Promise<PageData> {
  let fxStale = false;
  const [wallets, holdings, fx, base, alchemy] = await Promise.all([
    db.select().from(schema.ethWallets).orderBy(desc(schema.ethWallets.id)),
    db
      .select()
      .from(schema.holdingsCache)
      .where(eq(schema.holdingsCache.sourceType, "eth")),
    getFxToMad().catch(() => {
      fxStale = true;
      return { MAD: 1 } as FxTable;
    }),
    getBaseCurrency(),
    getAlchemyApiKey(),
  ]);
  return {
    wallets,
    holdings,
    fx,
    base,
    alchemyConfigured: Boolean(alchemy),
    fxStale,
  };
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-screen flex flex-col bg-[var(--background)] overflow-hidden">
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="w-full px-4 md:px-6 py-5 md:py-8 space-y-8">
          {children}
        </div>
      </div>
    </div>
  );
}

export default function WalletsPage() {
  useWide(true);
  const { data, error, reload } = useFinanceData(
    ["wallets", "settings", "dashboard"],
    load,
  );

  if (error && !data) {
    return (
      <Shell>
        <PageHeader
          icon={Coins}
          title="ETH Wallets"
          subtitle="Public Ethereum addresses · native ETH + ERC-20 via Alchemy."
          right={<RefreshButton />}
        />
        <ErrorCard message={error} onRetry={reload} />
      </Shell>
    );
  }

  if (!data) {
    return (
      <Shell>
        <PageSkeleton />
      </Shell>
    );
  }

  const { wallets, holdings, fx, base, alchemyConfigured, fxStale } = data;

  const byWallet = new Map<number, Holding[]>();
  for (const h of holdings) {
    const list = byWallet.get(h.sourceId) || [];
    list.push(h);
    byWallet.set(h.sourceId, list);
  }

  return (
    <Shell>
      <PageHeader
        icon={Coins}
        title="ETH Wallets"
        subtitle="Public Ethereum addresses · native ETH + ERC-20 via Alchemy."
        right={<RefreshButton />}
      />

      {fxStale && (
        <div className="flex items-center gap-2 text-[11px] text-amber-300">
          <AlertTriangle size={13} strokeWidth={2} />
          Live FX unavailable — showing approximate totals.
        </div>
      )}

      <GlassCard>
        <div className="max-w-3xl">
          <h2 className="font-medium mb-4">Add an ETH address</h2>
          {!alchemyConfigured && (
            <div className="mb-4 flex gap-3 items-start rounded-xl bg-amber-500/[0.06] border border-amber-400/20 px-3 py-2.5 text-sm max-w-prose">
              <AlertTriangle
                size={16}
                className="text-amber-300 mt-0.5 shrink-0"
              />
              <div>
                Add an{" "}
                <a
                  className="underline text-amber-200"
                  href="https://www.alchemy.com"
                  target="_blank"
                  rel="noreferrer"
                >
                  Alchemy
                </a>{" "}
                API key on the Settings page to enable wallet balance fetching.
              </div>
            </div>
          )}
          <WalletCreateForm />
        </div>
      </GlassCard>

      {wallets.length === 0 ? (
        <div className="max-w-2xl">
          <EmptyState
            icon={Coins}
            title="No wallets yet."
            hint="Add an Ethereum address above to start tracking balances."
          />
        </div>
      ) : (
        <div className="grid gap-6 xl:grid-cols-2 2xl:grid-cols-3 items-start">
          {wallets.map((w) => {
            const rows = byWallet.get(w.id) || [];
            const total = rows.reduce((s, r) => s + r.valueMad, 0);
            return (
              <GlassCard key={w.id} padding={false}>
                <div className="px-4 sm:px-5 py-4 flex flex-nowrap justify-between items-start gap-3 border-b border-white/5">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">{w.label}</div>
                    <div className="font-mono text-xs text-neutral-500 truncate">
                      {w.address}
                    </div>
                  </div>
                  <div className="text-right text-sm shrink-0">
                    <div className="font-semibold tabular-nums">
                      <Sensitive>{fmtBase(total, base, fx)}</Sensitive>
                    </div>
                    <div className="text-[11px] text-neutral-500">
                      synced {fmtDateTime(w.lastSyncedAt)}
                    </div>
                    {w.lastError && (
                      <div className="text-[11px] text-rose-300 max-w-[200px] truncate">
                        {w.lastError}
                      </div>
                    )}
                    <WalletDeleteForm id={w.id} />
                  </div>
                </div>
                <AssetsTable
                  rows={rows}
                  emptyText='No balances cached. Click "Refresh all" above.'
                  base={base}
                  fx={fx}
                />
              </GlassCard>
            );
          })}
        </div>
      )}
    </Shell>
  );
}
