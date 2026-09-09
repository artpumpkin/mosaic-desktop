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
import Sensitive from "@/components/Sensitive";
import PageSkeleton from "@/components/PageSkeleton";
import EmptyState from "@/components/EmptyState";
import ErrorCard from "@/components/ErrorCard";
import {
  DebtCreateForm,
  DebtRowDesktop,
  DebtRowMobile,
} from "@/components/forms/DebtForms";
import {
  HandCoins,
  Plus,
  ArrowDownLeft,
  ArrowUpRight,
  AlertTriangle,
} from "lucide-react";

type Debt = typeof schema.debts.$inferSelect;
type PageData = { rows: Debt[]; fx: FxTable; base: BaseCurrency };

async function load(): Promise<PageData> {
  const [rows, fx, base] = await Promise.all([
    db.select().from(schema.debts).orderBy(desc(schema.debts.id)),
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

export default function DebtsPage() {
  useWide(true);
  const { data, error, reload } = useFinanceData(["debts"], load);

  if (error && !data) {
    return (
      <Shell>
        <PageHeader
          icon={HandCoins}
          title="Debts"
          subtitle="Track what you owe and what you're owed."
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
  const fxStale = Object.keys(fx).length <= 1;

  const iOwe = rows.filter((d) => d.direction === "i_owe");
  const owedToMe = rows.filter((d) => d.direction === "owed_to_me");

  const totalIOwe = iOwe
    .filter((d) => d.status === "open")
    .reduce((s, d) => s + toMad(d.amount, d.currency, fx), 0);
  const totalOwedToMe = owedToMe
    .filter((d) => d.status === "open")
    .reduce((s, d) => s + toMad(d.amount, d.currency, fx), 0);

  return (
    <Shell>
      <PageHeader
        icon={HandCoins}
        title="Debts"
        subtitle={
          <span>
            I owe{" "}
            <span className="text-rose-300 tabular-nums">
              <Sensitive>{fmtBase(totalIOwe, base, fx)}</Sensitive>
            </span>{" "}
            · Owed to me{" "}
            <span className="text-emerald-300 tabular-nums">
              <Sensitive>{fmtBase(totalOwedToMe, base, fx)}</Sensitive>
            </span>
          </span>
        }
      />

      {fxStale && (
        <div className="flex items-center gap-2 rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2 text-[11px] text-amber-300 max-w-prose">
          <AlertTriangle size={14} strokeWidth={2} />
          Live FX unavailable — showing approximate totals.
        </div>
      )}

      <GlassCard>
        <h2 className="font-medium mb-4 flex items-center gap-2">
          <Plus size={16} className="text-violet-300" /> Add a debt
        </h2>
        <div className="max-w-5xl">
          <DebtCreateForm />
        </div>
      </GlassCard>

      <div className="grid gap-8 2xl:grid-cols-2 items-start">
        <DebtTable
          title="I owe"
          icon={ArrowUpRight}
          accentClass="text-rose-300"
          rows={iOwe}
          fx={fx}
          base={base}
        />
        <DebtTable
          title="Owed to me"
          icon={ArrowDownLeft}
          accentClass="text-emerald-300"
          rows={owedToMe}
          fx={fx}
          base={base}
        />
      </div>
    </Shell>
  );
}

function DebtTable({
  title,
  icon: Icon,
  accentClass,
  rows,
  fx,
  base,
}: {
  title: string;
  icon: typeof ArrowUpRight;
  accentClass: string;
  rows: Debt[];
  fx: FxTable;
  base: string;
}) {
  return (
    <GlassCard padding={false}>
      <div className="px-4 sm:px-5 py-3.5 border-b border-white/5 flex items-center justify-between gap-3">
        <h2 className={`font-medium flex items-center gap-2 ${accentClass}`}>
          <Icon size={16} /> {title}
        </h2>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={Icon}
          title="Nothing here yet."
          hint="Add a debt above to start tracking."
        />
      ) : (
        <div className="max-h-[28rem] overflow-y-auto">
          <div className="hidden lg:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-neutral-500 border-b border-white/5 sticky top-0 bg-[var(--surface-1)] backdrop-blur z-10">
                <tr>
                  <th className="px-4 sm:px-5 py-3">Counterparty</th>
                  <th className="px-4 sm:px-5 py-3 text-right">Amount</th>
                  <th className="px-4 sm:px-5 py-3 text-right">≈ {base}</th>
                  <th className="px-4 sm:px-5 py-3">Due</th>
                  <th className="px-4 sm:px-5 py-3">Status</th>
                  <th className="px-4 sm:px-5 py-3">Note</th>
                  <th className="px-4 sm:px-5 py-3">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <DebtRowDesktop
                    key={d.id}
                    row={d}
                    baseDisplay={fmtBase(toMad(d.amount, d.currency, fx), base, fx)}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <ul className="lg:hidden divide-y divide-white/[0.04]">
            {rows.map((d) => (
              <DebtRowMobile
                key={d.id}
                row={d}
                baseDisplay={fmtBase(toMad(d.amount, d.currency, fx), base, fx)}
              />
            ))}
          </ul>
        </div>
      )}
    </GlassCard>
  );
}
