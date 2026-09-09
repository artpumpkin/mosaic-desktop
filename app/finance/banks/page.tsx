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
import Sensitive from "@/components/Sensitive";
import { BankCreateForm, BankRow } from "@/components/forms/BankForms";
import { Landmark } from "lucide-react";

type BankRowData = typeof schema.bankAccounts.$inferSelect;
type PageData = { rows: BankRowData[]; fx: FxTable; base: BaseCurrency };

async function load(): Promise<PageData> {
  const [rows, fx, base] = await Promise.all([
    db.select().from(schema.bankAccounts).orderBy(desc(schema.bankAccounts.id)),
    getFxToMad().catch(() => ({ MAD: 1 }) as FxTable),
    getBaseCurrency(),
  ]);
  return { rows, fx, base };
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

export default function BanksPage() {
  useWide(true);
  const { data, error, reload } = useFinanceData(["banks"], load);

  if (error) {
    return (
      <Shell>
        <PageHeader
          icon={Landmark}
          title="Bank Accounts"
          subtitle="Track your bank balances."
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

  const { rows, fx, base } = data;
  const total = rows.reduce((s, r) => s + toMad(r.balance, r.currency, fx), 0);
  const fxUnavailable = Object.keys(fx).length <= 1;

  return (
    <Shell>
      <PageHeader
        icon={Landmark}
        title="Bank Accounts"
        subtitle={
          <>
            Track your bank balances. Total ≈{" "}
            <Sensitive>{fmtBase(total, base, fx)}</Sensitive>.
          </>
        }
      />

      {fxUnavailable && (
        <p className="text-[11px] text-amber-300/80 max-w-prose">
          Live FX unavailable — showing approximate totals.
        </p>
      )}

      <GlassCard>
        <h2 className="font-medium mb-4">Add a bank account</h2>
        <div className="max-w-3xl">
          <BankCreateForm />
        </div>
      </GlassCard>

      {rows.length === 0 ? (
        <EmptyState
          icon={Landmark}
          title="No bank accounts yet."
          hint="Add one above to start tracking balances."
        />
      ) : (
        <GlassCard padding={false}>
          <div className="px-4 sm:px-5 py-3.5 border-b border-white/5 flex items-center justify-between gap-3">
            <h2 className="font-medium">Accounts</h2>
            <span className="text-[11px] uppercase tracking-wider text-neutral-500 tabular-nums">
              {rows.length} {rows.length === 1 ? "account" : "accounts"}
            </span>
          </div>
          <div className="max-h-[28rem] overflow-y-auto">
            <ul className="divide-y divide-white/[0.04]">
              {rows.map((r) => (
                <li key={r.id} className="px-4 sm:px-5 py-4">
                  <div className="max-w-5xl">
                    <BankRow
                      row={r}
                      baseDisplay={fmtBase(toMad(r.balance, r.currency, fx), base, fx)}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </GlassCard>
      )}
    </Shell>
  );
}
