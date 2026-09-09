"use client";
import { desc } from "drizzle-orm";
import { useWide } from "@/lib/appLayout";
import { db, schema } from "@/lib/db/client";
import { fmtBase, toMad, type FxTable } from "@/lib/format";
import { getFxToMad } from "@/lib/integrations/fx";
import { getBaseCurrency, type BaseCurrency } from "@/lib/settings";
import { useFinanceData } from "@/lib/query/useFinanceData";
import GlassCard from "@/components/GlassCard";
import Sensitive from "@/components/Sensitive";
import PageHeader from "@/components/PageHeader";
import PageSkeleton from "@/components/PageSkeleton";
import EmptyState from "@/components/EmptyState";
import ErrorCard from "@/components/ErrorCard";
import {
  ExpenseCreateForm,
  ExpenseDeleteForm,
  BudgetUpsertForm,
  BudgetDeleteForm,
} from "@/components/forms/ExpenseForms";
import { TrendingDown, Plus, Target, AlertTriangle } from "lucide-react";

type Expense = typeof schema.expenses.$inferSelect;
type Budget = typeof schema.expenseBudgets.$inferSelect;
type PageData = {
  expenses: Expense[];
  budgets: Budget[];
  fx: FxTable;
  base: BaseCurrency;
  fxStale: boolean;
};

async function load(): Promise<PageData> {
  let fxStale = false;
  const [expenses, budgets, fx, base] = await Promise.all([
    db
      .select()
      .from(schema.expenses)
      .orderBy(desc(schema.expenses.occurredOn), desc(schema.expenses.id)),
    db.select().from(schema.expenseBudgets),
    getFxToMad().catch(() => {
      fxStale = true;
      return { MAD: 1 } as FxTable;
    }),
    getBaseCurrency(),
  ]);
  return { expenses, budgets, fx, base, fxStale };
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

export default function ExpensesPage() {
  useWide(true);
  const { data, error, reload } = useFinanceData(["expenses"], load);

  if (error && !data) {
    return (
      <Shell>
        <PageHeader
          icon={TrendingDown}
          title="Expenses"
          subtitle="Track spending and budgets."
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

  const { expenses, budgets, fx, base, fxStale } = data;
  const f = (mad: number) => fmtBase(mad, base, fx);

  const today = new Date().toISOString().slice(0, 10);
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
    .toISOString()
    .slice(0, 10);
  const thisMonth = expenses.filter((e) => e.occurredOn >= monthStart);

  const spentByCategory = new Map<string, number>();
  for (const e of thisMonth) {
    const mad = toMad(e.amount, e.currency, fx);
    spentByCategory.set(e.category, (spentByCategory.get(e.category) || 0) + mad);
  }

  const budgetRowByCategory = new Map<string, Budget>(
    budgets.map((b) => [b.category, b]),
  );
  const allCategories = Array.from(
    new Set([...spentByCategory.keys(), ...budgetRowByCategory.keys()]),
  ).sort();

  const totalSpent = thisMonth.reduce(
    (s, e) => s + toMad(e.amount, e.currency, fx),
    0,
  );

  return (
    <Shell>
      <PageHeader
        icon={TrendingDown}
        title="Expenses"
        subtitle={
          <>
            This month: <Sensitive>{f(totalSpent)}</Sensitive>
          </>
        }
      />

      {fxStale && (
        <div className="flex w-fit items-center gap-2 rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2 text-[13px] text-amber-300">
          <AlertTriangle size={14} strokeWidth={2} className="shrink-0" />
          Live FX unavailable — showing approximate totals.
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-2 items-start">
        <GlassCard>
          <h2 className="font-medium mb-4 flex items-center gap-2">
            <Plus size={16} className="text-violet-300" /> Log an expense
          </h2>
          <ExpenseCreateForm today={today} />
        </GlassCard>

        <GlassCard>
          <h2 className="font-medium mb-4 flex items-center gap-2">
            <Target size={16} className="text-violet-300" />
            Budget vs actual · this month
          </h2>
          <div className="max-w-3xl">
            <BudgetUpsertForm />
          </div>

          <div className="space-y-4">
            {allCategories.length === 0 && (
              <p className="text-sm text-neutral-400">No categories yet.</p>
            )}
            {allCategories.map((cat) => {
            const spent = spentByCategory.get(cat) || 0;
            const budgetRow = budgetRowByCategory.get(cat);
            const budget = budgetRow?.monthlyAmountMad || 0;
            const pct = budget > 0 ? (spent / budget) * 100 : 0;
            const over = budget > 0 && spent > budget;
            return (
              <div key={cat}>
                <div className="flex justify-between items-center text-sm mb-1.5 gap-3">
                  <span className="font-medium flex items-center gap-2">
                    {cat}
                    {over && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-rose-500/15 border border-rose-500/25 px-1.5 py-0.5 text-[11px] font-medium text-rose-300 tabular-nums">
                        <AlertTriangle size={11} strokeWidth={2} />
                        {Math.round(pct)}%
                      </span>
                    )}
                  </span>
                  <span
                    className={
                      over
                        ? "text-rose-300 tabular-nums"
                        : "text-neutral-300 tabular-nums"
                    }
                  >
                    <Sensitive>{f(spent)}</Sensitive>
                    {budget > 0 ? (
                      <span className="text-neutral-500">
                        {" "}
                        / <Sensitive>{f(budget)}</Sensitive>
                      </span>
                    ) : (
                      <span className="text-neutral-500"> · no budget</span>
                    )}
                  </span>
                </div>
                <div className="h-1.5 w-full bg-white/[0.06] rounded-full overflow-hidden">
                  <div
                    className={
                      over
                        ? "h-full rounded-full bg-gradient-to-r from-rose-400 to-rose-600"
                        : "h-full rounded-full bg-gradient-to-r from-violet-400 to-fuchsia-400"
                    }
                    style={{ width: `${budget > 0 ? Math.min(100, pct) : 0}%` }}
                  />
                </div>
                {budgetRow && <BudgetDeleteForm id={budgetRow.id} />}
              </div>
            );
          })}
          </div>
        </GlassCard>
      </div>

      {expenses.length === 0 ? (
        <EmptyState
          icon={TrendingDown}
          title="No expenses yet"
          hint="Log one above to start tracking your spending."
        />
      ) : (
        <GlassCard padding={false}>
          <div className="px-4 sm:px-5 py-3.5 border-b border-white/5 flex items-center justify-between gap-3">
            <h2 className="font-medium">Expenses</h2>
          </div>
          <div className="max-h-[28rem] overflow-y-auto">
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wider text-neutral-500">
                  <tr className="sticky top-0 bg-[var(--surface-1)] backdrop-blur z-10 border-b border-white/5">
                    <th className="px-4 sm:px-5 py-3">Date</th>
                    <th className="px-4 sm:px-5 py-3">Category</th>
                    <th className="px-4 sm:px-5 py-3 text-right">Amount</th>
                    <th className="px-4 sm:px-5 py-3 text-right">≈ {base}</th>
                    <th className="px-4 sm:px-5 py-3">Note</th>
                    <th className="px-4 sm:px-5 py-3">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {expenses.map((e) => (
                    <tr
                      key={e.id}
                      className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02] transition-colors"
                    >
                      <td className="px-4 sm:px-5 py-3 text-neutral-400 whitespace-nowrap">
                        {e.occurredOn}
                      </td>
                      <td className="px-4 sm:px-5 py-3">{e.category}</td>
                      <td className="px-4 sm:px-5 py-3 text-right tabular-nums whitespace-nowrap">
                        <Sensitive>
                          {e.amount.toLocaleString()} {e.currency}
                        </Sensitive>
                      </td>
                      <td className="px-4 sm:px-5 py-3 text-right text-neutral-500 tabular-nums whitespace-nowrap">
                        <Sensitive>{f(toMad(e.amount, e.currency, fx))}</Sensitive>
                      </td>
                      <td className="px-4 sm:px-5 py-3 text-neutral-500">{e.note}</td>
                      <td className="px-4 sm:px-5 py-3 text-right">
                        <ExpenseDeleteForm id={e.id} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="lg:hidden divide-y divide-white/[0.04]">
              {expenses.map((e) => (
                <li
                  key={e.id}
                  className="px-4 sm:px-5 py-3 flex items-start gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">{e.category}</span>
                      <span className="text-[11px] text-neutral-500">
                        {e.occurredOn}
                      </span>
                    </div>
                    <div className="text-sm tabular-nums mt-0.5">
                      <Sensitive>
                        {e.amount.toLocaleString()} {e.currency}
                      </Sensitive>{" "}
                      <span className="text-neutral-500">
                        · <Sensitive>{f(toMad(e.amount, e.currency, fx))}</Sensitive>
                      </span>
                    </div>
                    {e.note && (
                      <div className="text-xs text-neutral-500 mt-0.5 break-words line-clamp-2">
                        {e.note}
                      </div>
                    )}
                  </div>
                  <ExpenseDeleteForm id={e.id} className="shrink-0" />
                </li>
              ))}
            </ul>
          </div>
        </GlassCard>
      )}
    </Shell>
  );
}
