"use client";
import { desc } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { fmtBase, fmtDateTime, type FxTable } from "@/lib/format";
import { getFxToMad } from "@/lib/integrations/fx";
import { getBaseCurrency, type BaseCurrency } from "@/lib/settings";
import { useFinanceData } from "@/lib/query/useFinanceData";
import { useWide } from "@/lib/appLayout";
import GlassCard from "@/components/GlassCard";
import Sensitive from "@/components/Sensitive";
import PageHeader from "@/components/PageHeader";
import PageSkeleton from "@/components/PageSkeleton";
import EmptyState from "@/components/EmptyState";
import ErrorCard from "@/components/ErrorCard";
import RefreshButton from "@/components/RefreshButton";
import AssetsTable from "@/components/AssetsTable";
import {
  ExchangeCreateForm,
  ExchangeDeleteForm,
} from "@/components/forms/ExchangeForms";
import { CandlestickChart, ShieldAlert } from "lucide-react";

type ExchangeAcc = typeof schema.exchangeAccounts.$inferSelect;
type Holding = typeof schema.holdingsCache.$inferSelect;
type PageData = {
  accounts: ExchangeAcc[];
  holdings: Holding[];
  fx: FxTable;
  base: BaseCurrency;
};

async function load(): Promise<PageData> {
  const [accounts, holdings, fx, base] = await Promise.all([
    db
      .select()
      .from(schema.exchangeAccounts)
      .orderBy(desc(schema.exchangeAccounts.id)),
    db.select().from(schema.holdingsCache),
    getFxToMad().catch(() => ({ MAD: 1 }) as FxTable),
    getBaseCurrency(),
  ]);
  return { accounts, holdings, fx, base };
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

export default function ExchangesPage() {
  useWide(true);
  const { data, error, reload } = useFinanceData(
    ["exchanges", "dashboard"],
    load,
  );

  const header = (
    <PageHeader
      icon={CandlestickChart}
      title="Exchange Accounts"
      subtitle="Binance & OKX read-only API keys · AES-256-GCM encrypted at rest."
      right={<RefreshButton />}
    />
  );

  if (error) {
    return (
      <Shell>
        {header}
        <ErrorCard message={error} onRetry={reload} />
      </Shell>
    );
  }

  if (!data) {
    return (
      <Shell>
        {header}
        <PageSkeleton />
      </Shell>
    );
  }

  const { accounts, holdings, fx, base } = data;
  const fxUnavailable = base !== "MAD" && fx[base] === undefined;

  const byAccount = new Map<string, Holding[]>();
  for (const h of holdings) {
    if (h.sourceType === "eth") continue;
    const key = `${h.sourceType}:${h.sourceId}`;
    const list = byAccount.get(key) || [];
    list.push(h);
    byAccount.set(key, list);
  }

  return (
    <Shell>
      {header}

      <GlassCard>
        <h2 className="font-medium mb-4">Add an exchange</h2>
        <p className="text-xs text-amber-300/90 mb-4 flex items-center gap-1.5 max-w-prose">
          <ShieldAlert size={13} className="shrink-0" />
          <span>
            Use <strong>read-only</strong> API keys with withdrawals disabled.
          </span>
        </p>
        <div className="max-w-5xl">
          <ExchangeCreateForm />
        </div>
      </GlassCard>

      {accounts.length === 0 ? (
        <EmptyState
          icon={CandlestickChart}
          title="No exchange accounts yet."
          hint="Add a read-only exchange API key above to track balances."
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2 2xl:grid-cols-3">
          {accounts.map((acc) => {
            const rows = byAccount.get(`${acc.exchange}:${acc.id}`) || [];
            const total = rows.reduce((s, r) => s + r.valueMad, 0);
            return (
              <GlassCard key={acc.id} padding={false}>
                <div className="px-4 sm:px-5 py-4 flex flex-nowrap justify-between items-start gap-3 border-b border-white/5">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium flex items-center gap-2 min-w-0">
                      <span className="shrink-0 px-2 py-0.5 rounded-md text-xs uppercase tracking-wider bg-gradient-to-r from-violet-500/20 to-fuchsia-500/20 border border-violet-400/20 text-violet-200">
                        {acc.exchange}
                      </span>
                      <span className="truncate">{acc.label}</span>
                    </div>
                    <div className="text-[11px] text-neutral-500 mt-1">
                      synced {fmtDateTime(acc.lastSyncedAt)}
                    </div>
                    {acc.lastError && (
                      <div className="text-[11px] text-rose-300 mt-0.5 break-words">
                        {acc.lastError}
                      </div>
                    )}
                  </div>
                  <div className="text-right text-sm shrink-0 flex flex-col items-end gap-1">
                    <div className="font-semibold tabular-nums">
                      <Sensitive>{fmtBase(total, base, fx)}</Sensitive>
                    </div>
                    {fxUnavailable && (
                      <div className="text-[11px] text-amber-300/90">
                        Live FX unavailable — approximate
                      </div>
                    )}
                    <ExchangeDeleteForm id={acc.id} />
                  </div>
                </div>
                <AssetsTable
                  rows={rows}
                  emptyText='No balances cached. Click "Refresh all".'
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
