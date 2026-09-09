"use client";
import { desc } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { fmtBase, toMad, type FxTable } from "@/lib/format";
import { getFxToMad } from "@/lib/integrations/fx";
import { getBaseCurrency, type BaseCurrency } from "@/lib/settings";
import { useFinanceData } from "@/lib/query/useFinanceData";
import { useWide } from "@/lib/appLayout";
import GlassCard from "@/components/GlassCard";
import PageHeader from "@/components/PageHeader";
import PageSkeleton from "@/components/PageSkeleton";
import EmptyState from "@/components/EmptyState";
import ErrorCard from "@/components/ErrorCard";
import { CashCreateForm, CashRow } from "@/components/forms/CashForms";
import Sensitive from "@/components/Sensitive";
import { Wallet, AlertTriangle } from "lucide-react";

type CashRowData = typeof schema.cashHoldings.$inferSelect;
type PageData = { rows: CashRowData[]; fx: FxTable; base: BaseCurrency; fxDown: boolean };

async function load(): Promise<PageData> {
  let fxDown = false;
  const [rows, fx, base] = await Promise.all([
    db.select().from(schema.cashHoldings).orderBy(desc(schema.cashHoldings.id)),
    getFxToMad().catch(() => {
      fxDown = true;
      return { MAD: 1 } as FxTable;
    }),
    getBaseCurrency(),
  ]);
  return { rows, fx, base, fxDown };
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

export default function CashPage() {
  useWide(true);
  const { data, error, reload } = useFinanceData(["cash"], load);

  if (error) {
    return (
      <Shell>
        <PageHeader icon={Wallet} title="Cash" subtitle="Physical cash on hand." />
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

  const { rows, fx, base, fxDown } = data;
  const total = rows.reduce((s, r) => s + toMad(r.amount, r.currency, fx), 0);

  return (
    <Shell>
      <PageHeader
        icon={Wallet}
        title="Cash"
        subtitle={<>Physical cash on hand. Total ≈ <Sensitive>{fmtBase(total, base, fx)}</Sensitive></>}
      />

      {fxDown && (
        <div className="flex w-fit items-center gap-2 rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2 text-[11px] text-amber-300">
          <AlertTriangle size={14} strokeWidth={2} />
          Live FX unavailable — totals approximate.
        </div>
      )}

      <GlassCard>
        <h2 className="font-medium mb-4">Add a cash holding</h2>
        <div className="max-w-3xl">
          <CashCreateForm />
        </div>
      </GlassCard>

      {rows.length === 0 ? (
        <div className="max-w-xl mx-auto">
          <EmptyState
            icon={Wallet}
            title="No cash holdings yet"
            hint="Add one above to start tracking physical cash."
          />
        </div>
      ) : (
        <GlassCard padding={false} className="max-w-5xl">
          <div className="px-4 sm:px-5 py-3.5 border-b border-white/5 flex items-center justify-between gap-3">
            <h2 className="font-medium">Holdings</h2>
            <span className="text-[11px] uppercase tracking-wider text-neutral-500">
              {rows.length} {rows.length === 1 ? "holding" : "holdings"}
            </span>
          </div>
          <ul className="divide-y divide-white/[0.04] max-h-[28rem] overflow-y-auto">
            {rows.map((r) => (
              <li key={r.id} className="px-4 sm:px-5 py-3">
                <CashRow
                  row={r}
                  baseDisplay={fmtBase(toMad(r.amount, r.currency, fx), base, fx)}
                />
              </li>
            ))}
          </ul>
        </GlassCard>
      )}
    </Shell>
  );
}
