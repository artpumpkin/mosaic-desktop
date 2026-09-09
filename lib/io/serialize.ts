import { getTableColumns, getTableName } from "drizzle-orm";
import { invoke } from "@tauri-apps/api/core";
import { db, schema } from "@/lib/db/client";
import { encrypt, decrypt } from "@/lib/crypto/encrypt";

export const EXPORT_VERSION = 1;

type ExchangeAccountExport = {
  id: number;
  exchange: "binance" | "okx";
  label: string;
  apiKey: string;
  apiSecret: string;
  passphrase: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
};

export type Export = {
  version: number;
  exportedAt: string;
  tables: {
    bankAccounts: (typeof schema.bankAccounts.$inferSelect)[];
    cashHoldings: (typeof schema.cashHoldings.$inferSelect)[];
    exchangeAccounts: ExchangeAccountExport[];
    ethWallets: (typeof schema.ethWallets.$inferSelect)[];
    holdingsCache: (typeof schema.holdingsCache.$inferSelect)[];
    expenses: (typeof schema.expenses.$inferSelect)[];
    expenseBudgets: (typeof schema.expenseBudgets.$inferSelect)[];
    incomes: (typeof schema.incomes.$inferSelect)[];
    debts: (typeof schema.debts.$inferSelect)[];
    netWorthSnapshots: (typeof schema.netWorthSnapshots.$inferSelect)[];
    fxRates: (typeof schema.fxRates.$inferSelect)[];
    appSettings: (typeof schema.appSettings.$inferSelect)[];
    weightEntries?: (typeof schema.weightEntries.$inferSelect)[];
    assets?: (typeof schema.assets.$inferSelect)[];
    fastingSessions?: (typeof schema.fastingSessions.$inferSelect)[];
  };
};

export async function exportToJson(): Promise<string> {
  const [
    bankAccounts,
    cashHoldings,
    exchanges,
    ethWallets,
    holdingsCache,
    expenses,
    expenseBudgets,
    incomes,
    debts,
    netWorthSnapshots,
    fxRates,
    appSettings,
    weightEntries,
    assets,
    fastingSessions,
  ] = await Promise.all([
    db.select().from(schema.bankAccounts),
    db.select().from(schema.cashHoldings),
    db.select().from(schema.exchangeAccounts),
    db.select().from(schema.ethWallets),
    db.select().from(schema.holdingsCache),
    db.select().from(schema.expenses),
    db.select().from(schema.expenseBudgets),
    db.select().from(schema.incomes),
    db.select().from(schema.debts),
    db.select().from(schema.netWorthSnapshots),
    db.select().from(schema.fxRates),
    db.select().from(schema.appSettings),
    db.select().from(schema.weightEntries),
    db.select().from(schema.assets),
    db.select().from(schema.fastingSessions),
  ]);

  const exchangeAccounts: ExchangeAccountExport[] = await Promise.all(
    exchanges.map(async (e) => ({
      id: e.id,
      exchange: e.exchange,
      label: e.label,
      apiKey: await decrypt(e.apiKeyEnc),
      apiSecret: await decrypt(e.apiSecretEnc),
      passphrase: e.passphraseEnc ? await decrypt(e.passphraseEnc) : null,
      lastSyncedAt: e.lastSyncedAt,
      lastError: e.lastError,
    })),
  );

  const payload: Export = {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    tables: {
      bankAccounts,
      cashHoldings,
      exchangeAccounts,
      ethWallets,
      holdingsCache,
      expenses,
      expenseBudgets,
      incomes,
      debts,
      netWorthSnapshots,
      fxRates,
      appSettings,
      weightEntries,
      assets,
      fastingSessions,
    },
  };

  return JSON.stringify(payload, null, 2);
}

export type ImportSummary = {
  bankAccounts: number;
  cashHoldings: number;
  exchangeAccounts: number;
  ethWallets: number;
  holdingsCache: number;
  expenses: number;
  expenseBudgets: number;
  incomes: number;
  debts: number;
  netWorthSnapshots: number;
  fxRates: number;
  appSettings: number;
  weightEntries: number;
  assets: number;
  fastingSessions: number;
};

const backupTables = {
  bankAccounts: schema.bankAccounts, cashHoldings: schema.cashHoldings,
  exchangeAccounts: schema.exchangeAccounts, ethWallets: schema.ethWallets,
  holdingsCache: schema.holdingsCache, expenses: schema.expenses,
  expenseBudgets: schema.expenseBudgets, incomes: schema.incomes,
  debts: schema.debts, netWorthSnapshots: schema.netWorthSnapshots,
  fxRates: schema.fxRates, appSettings: schema.appSettings,
  weightEntries: schema.weightEntries, assets: schema.assets, fastingSessions: schema.fastingSessions,
};

export async function importFromJson(json: string): Promise<ImportSummary> {
  if (json.length > 16 * 1024 * 1024) throw new Error("Backup exceeds 16 MiB");
  const data = JSON.parse(json) as Export;
  if (!data || data.version !== EXPORT_VERSION || !data.tables || typeof data.tables !== "object") {
    throw new Error("Invalid or unsupported backup file");
  }
  const tables: Record<string, Record<string, unknown>[]> = {};
  const summary = Object.fromEntries(Object.keys(backupTables).map(k => [k, 0])) as ImportSummary;
  for (const [name, table] of Object.entries(backupTables)) {
    const key = name as keyof typeof backupTables;
    const rows = data.tables[key];
    if (rows === undefined && ["weightEntries", "assets", "fastingSessions"].includes(name)) continue;
    if (!Array.isArray(rows) || rows.length > 100_000) throw new Error(`Invalid table: ${name}`);
    const columns: Record<string, { name: string }> = getTableColumns(table);
    const prepared: Record<string, unknown>[] = [];
    for (const raw of rows) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`Invalid row in ${name}`);
      let row: Record<string, unknown> = { ...raw };
      if (key === "exchangeAccounts") {
        const e = raw as ExchangeAccountExport;
        if (typeof e.apiKey !== "string" || typeof e.apiSecret !== "string" || (e.passphrase !== null && typeof e.passphrase !== "string")) throw new Error("Invalid exchange credentials");
        row = { id: e.id, exchange: e.exchange, label: e.label, apiKeyEnc: await encrypt(e.apiKey), apiSecretEnc: await encrypt(e.apiSecret), passphraseEnc: e.passphrase ? await encrypt(e.passphrase) : null, lastSyncedAt: e.lastSyncedAt, lastError: e.lastError };
      }
      const sqlRow: Record<string, unknown> = {};
      for (const [field, value] of Object.entries(row)) {
        if (!Object.hasOwn(columns, field) || (value !== null && !["string", "number", "boolean"].includes(typeof value))) throw new Error(`Invalid field in ${name}: ${field}`);
        const column = columns[field];
        sqlRow[column.name] = value;
      }
      prepared.push(sqlRow);
    }
    tables[getTableName(table)] = prepared;
    summary[key] = prepared.length;
  }
  // One native SQLite transaction. Validation/encryption finishes before any
  // writes, and constraint failures leave the original database intact.
  await db.select().from(schema.appSettings).limit(1); // initialize the native pool
  await invoke("import_backup", { tables });
  return summary;
}
