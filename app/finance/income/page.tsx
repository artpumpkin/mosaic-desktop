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
import {
  IncomeCreateForm,
  IncomeDeleteForm,
} from "@/components/forms/IncomeForms";
import { TrendingUp, Repeat } from "lucide-react";

type Income = typeof schema.incomes.$inferSelect;
type PageData = { incomes: Income[]; fx: FxTable; base: BaseCurrency };

async function load(): Promise<PageData> {
  const [incomes, fx, base] = await Promise.all([
    db
      .select()
      .from(schema.incomes)
      .orderBy(desc(schema.incomes.occurredOn), desc(schema.incomes.id)),
    getFxToMad().catch(() => ({ MAD: 1 }) as FxTable),
    getBaseCurrency(),
  ]);
  return { incomes, fx, base };
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

export default function IncomePage() {
  useWide(true);
  const { data, error, reload } = useFinanceData(["income"], load);

  if (error && !data) {
    return (
      <Shell>
        <PageHeader icon={TrendingUp} title="Income" subtitle="Track money coming in." />
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

  const { incomes, fx, base } = data;
  const f = (mad: number) => fmtBase(mad, base, fx);

  const today = new Date().toISOString().slice(0, 10);
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
    .toISOString()
    .slice(0, 10);
  const thisMonth = incomes
    .filter((i) => i.occurredOn >= monthStart)
    .reduce((s, i) => s + toMad(i.amount, i.currency, fx), 0);

  return (
    <Shell>
      <PageHeader
        icon={TrendingUp}
        title="Income"
        subtitle={<>This month: <Sensitive>{f(thisMonth)}</Sensitive></>}
      />

      <GlassCard>
        <h2 className="font-medium mb-4">Log income</h2>
        <div className="max-w-5xl">
          <IncomeCreateForm today={today} />
        </div>
      </GlassCard>

      <GlassCard padding={false}>
        <div className="px-4 sm:px-5 py-3.5 border-b border-white/5 flex items-center justify-between gap-3">
          <h2 className="font-medium">Income log</h2>
          {incomes.length > 0 && (
            <span className="text-[11px] uppercase tracking-wider text-neutral-500">
              {incomes.length} {incomes.length === 1 ? "entry" : "entries"}
            </span>
          )}
        </div>

        {incomes.length === 0 ? (
          <EmptyState
            icon={TrendingUp}
            title="No income logged yet — add one above."
          />
        ) : (
          <div className="max-h-[28rem] overflow-y-auto">
            <table className="hidden lg:table w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-neutral-500 sticky top-0 bg-[var(--surface-1)] backdrop-blur z-10">
                <tr className="border-b border-white/5">
                  <th className="px-4 sm:px-5 py-3.5 w-px whitespace-nowrap">Date</th>
                  <th className="px-4 sm:px-5 py-3.5">Source</th>
                  <th className="px-4 sm:px-5 py-3.5 text-right w-px whitespace-nowrap">Amount</th>
                  <th className="px-4 sm:px-5 py-3.5 text-right w-px whitespace-nowrap">≈ {base}</th>
                  <th className="px-4 sm:px-5 py-3.5 w-px whitespace-nowrap">Recurring</th>
                  <th className="px-4 sm:px-5 py-3.5 w-px">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {incomes.map((i) => (
                  <tr
                    key={i.id}
                    className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02] transition-colors"
                  >
                    <td className="px-4 sm:px-5 py-3 text-neutral-400 whitespace-nowrap">
                      {i.occurredOn}
                    </td>
                    <td className="px-4 sm:px-5 py-3">{i.source}</td>
                    <td className="px-4 sm:px-5 py-3 text-right tabular-nums whitespace-nowrap">
                      <Sensitive>{i.amount.toLocaleString()} {i.currency}</Sensitive>
                    </td>
                    <td className="px-4 sm:px-5 py-3 text-right text-neutral-500 tabular-nums whitespace-nowrap">
                      <Sensitive>{f(toMad(i.amount, i.currency, fx))}</Sensitive>
                    </td>
                    <td className="px-4 sm:px-5 py-3">
                      {i.recurring && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-300 text-xs border border-emerald-400/20">
                          <Repeat size={11} /> recurring
                        </span>
                      )}
                    </td>
                    <td className="px-4 sm:px-5 py-3 text-right">
                      <IncomeDeleteForm id={i.id} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <ul className="lg:hidden divide-y divide-white/[0.04]">
              {incomes.map((i) => (
                <li key={i.id} className="px-4 sm:px-5 py-3 flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium truncate">{i.source}</span>
                      <span className="text-[11px] text-neutral-500">
                        {i.occurredOn}
                      </span>
                    </div>
                    <div className="text-sm tabular-nums mt-0.5">
                      <Sensitive>{i.amount.toLocaleString()} {i.currency}</Sensitive>{" "}
                      <span className="text-neutral-500">
                        · <Sensitive>{f(toMad(i.amount, i.currency, fx))}</Sensitive>
                      </span>
                    </div>
                    {i.recurring && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-300 text-xs border border-emerald-400/20 mt-1">
                        <Repeat size={11} /> recurring
                      </span>
                    )}
                  </div>
                  <IncomeDeleteForm id={i.id} className="shrink-0" />
                </li>
              ))}
            </ul>
          </div>
        )}
      </GlassCard>
    </Shell>
  );
}
