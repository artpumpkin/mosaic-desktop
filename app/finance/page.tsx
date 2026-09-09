"use client";
import { useMemo } from "react";
import { desc } from "drizzle-orm";
import { useWide } from "@/lib/appLayout";
import { db, schema } from "@/lib/db/client";
import { computeNetWorth, type Breakdown } from "@/lib/refresh";
import { fmtBase, type FxTable } from "@/lib/format";
import { getFxToMad } from "@/lib/integrations/fx";
import { getBaseCurrency, type BaseCurrency } from "@/lib/settings";
import { useFinanceData } from "@/lib/query/useFinanceData";
import RefreshButton from "@/components/RefreshButton";
import NetWorthChart from "@/components/NetWorthChart";
import BreakdownPie from "@/components/BreakdownPie";
import GlassCard from "@/components/GlassCard";
import StatCard from "@/components/StatCard";
import PageSkeleton from "@/components/PageSkeleton";
import PageHeader from "@/components/PageHeader";
import EmptyState from "@/components/EmptyState";
import ErrorCard from "@/components/ErrorCard";
import Sensitive from "@/components/Sensitive";
import {
  Landmark,
  Wallet,
  CandlestickChart,
  Coins,
  HandCoins,
  TrendingUp,
  TrendingDown,
  ArrowDownRight,
  Sparkles,
  PieChart,
  LineChart,
  AlertTriangle,
} from "lucide-react";

type DashboardData = {
  totalMad: number;
  breakdown: Breakdown;
  base: BaseCurrency;
  fx: FxTable;
  fxStale: boolean;
  chartData: { date: string; total: number }[];
};

async function loadDashboard(): Promise<DashboardData> {
  const [net, base, fx] = await Promise.all([
    computeNetWorth(),
    getBaseCurrency(),
    getFxToMad().catch(() => ({ MAD: 1 }) as FxTable),
  ]);
  const fxStale = Object.keys(fx).length <= 1;
  const snapshots = await db
    .select()
    .from(schema.netWorthSnapshots)
    .orderBy(desc(schema.netWorthSnapshots.capturedAt))
    .limit(60);
  const chartData = snapshots
    .map((s) => ({ date: s.capturedAt.slice(0, 16), total: s.totalMad }))
    .reverse();
  return { totalMad: net.totalMad, breakdown: net.breakdown, base, fx, fxStale, chartData };
}

export default function Dashboard() {
  useWide(true);
  const { data, isLoading, error, reload } = useFinanceData(["dashboard"], loadDashboard);
  const f = useMemo(
    () => (mad: number) => (data ? fmtBase(mad, data.base, data.fx) : "—"),
    [data],
  );

  return (
    <div className="h-screen flex flex-col bg-[var(--background)] overflow-hidden">
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="w-full px-4 md:px-6 py-5 md:py-8 space-y-8">
          <PageHeader
            icon={CandlestickChart}
            title="Net worth"
            subtitle="Your total across banks, cash, crypto and debts."
            right={<RefreshButton />}
          />

          {error && !data ? (
            <ErrorCard message={error} onRetry={reload} />
          ) : !data ? (
            <PageSkeleton lines={6} loading={isLoading} />
          ) : (
            <DashboardBody data={data} f={f} />
          )}
        </div>
      </div>
    </div>
  );
}

function DashboardBody({
  data,
  f,
}: {
  data: DashboardData;
  f: (mad: number) => string;
}) {
  const { totalMad, breakdown, base, fx, fxStale, chartData } = data;

  const pieData = [
    { name: "Bank (MAD)", value: breakdown.banksMad },
    { name: "Bank (AED)", value: breakdown.banksAed },
    { name: "Bank (other)", value: breakdown.banksOther },
    { name: "Cash", value: breakdown.cash },
    { name: "Exchanges", value: breakdown.exchanges },
    { name: "ETH Wallets", value: breakdown.ethWallets },
    { name: "Owed to me", value: breakdown.debtsOwedToMe },
  ].filter((d) => d.value > 0);

  return (
    <>
      <GlassCard className="relative overflow-hidden">
        <div
          aria-hidden
          className="absolute -top-20 -right-20 w-80 h-80 rounded-full opacity-30 pointer-events-none"
          style={{
            background:
              "radial-gradient(circle, rgba(168,85,247,0.6), transparent 70%)",
          }}
        />
        <div className="relative flex flex-wrap items-end justify-between gap-6">
          <div className="min-w-0 max-w-3xl">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-violet-300/80">
              <Sparkles size={14} />
              Total net worth
            </div>
            <div className="mt-3 text-4xl sm:text-5xl lg:text-6xl xl:text-7xl font-semibold tracking-tight leading-none gradient-text tabular-nums break-words">
              <Sensitive>{f(totalMad)}</Sensitive>
            </div>
            {fxStale && (
              <div className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 px-2.5 py-1 text-[11px] text-amber-300">
                <AlertTriangle size={13} />
                Live FX unavailable — showing approximate totals
              </div>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
              <span className="flex items-center gap-1.5 text-emerald-300">
                <TrendingUp size={14} />
                <span className="text-neutral-400">Income MTD</span>
                <span className="font-medium tabular-nums">
                  <Sensitive>{f(breakdown.income)}</Sensitive>
                </span>
              </span>
              <span className="flex items-center gap-1.5 text-rose-300">
                <TrendingDown size={14} />
                <span className="text-neutral-400">Spent MTD</span>
                <span className="font-medium tabular-nums">
                  <Sensitive>{f(breakdown.expensesThisMonth)}</Sensitive>
                </span>
              </span>
              <span className="flex items-center gap-1.5 text-rose-300">
                <ArrowDownRight size={14} />
                <span className="text-neutral-400">I owe</span>
                <span className="font-medium tabular-nums">
                  <Sensitive>{f(breakdown.debtsIOwe)}</Sensitive>
                </span>
              </span>
            </div>
          </div>
        </div>
      </GlassCard>

      <div className="grid gap-6 xl:grid-cols-5">
        <GlassCard className="min-w-0 xl:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-medium">Breakdown</h2>
            <span className="text-[11px] uppercase tracking-wider text-neutral-500">
              by source
            </span>
          </div>
          {pieData.length === 0 ? (
            <EmptyState
              icon={PieChart}
              title='Add accounts and click "Refresh all" to see the split.'
            />
          ) : (
            <BreakdownPie data={pieData} total={totalMad} base={base} fx={fx} />
          )}
        </GlassCard>
        <GlassCard className="min-w-0 xl:col-span-3">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-medium">Net worth trend</h2>
            <span className="text-[11px] uppercase tracking-wider text-neutral-500">
              last 60 snapshots
            </span>
          </div>
          {chartData.length < 2 ? (
            <EmptyState
              icon={LineChart}
              title='At least 2 snapshots needed — click "Refresh all" again later.'
            />
          ) : (
            <NetWorthChart data={chartData} base={base} fx={fx} />
          )}
        </GlassCard>
      </div>

      <div>
        <h2 className="font-medium mb-4 text-sm uppercase tracking-wider text-neutral-400">
          Composition
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-8 gap-4">
          <StatCard
            icon={Landmark}
            label="Bank · MAD"
            value={<Sensitive>{f(breakdown.banksMad)}</Sensitive>}
          />
          <StatCard
            icon={Landmark}
            label="Bank · AED"
            value={<Sensitive>{f(breakdown.banksAed)}</Sensitive>}
          />
          <StatCard
            icon={Landmark}
            label="Bank · other"
            value={<Sensitive>{f(breakdown.banksOther)}</Sensitive>}
          />
          <StatCard
            icon={Wallet}
            label="Cash"
            value={<Sensitive>{f(breakdown.cash)}</Sensitive>}
          />
          <StatCard
            icon={CandlestickChart}
            label="Exchanges"
            value={<Sensitive>{f(breakdown.exchanges)}</Sensitive>}
          />
          <StatCard
            icon={Coins}
            label="ETH wallets"
            value={<Sensitive>{f(breakdown.ethWallets)}</Sensitive>}
          />
          <StatCard
            icon={HandCoins}
            label="Owed to me"
            value={<Sensitive>{f(breakdown.debtsOwedToMe)}</Sensitive>}
            tone="positive"
          />
          <StatCard
            icon={HandCoins}
            label="I owe"
            value={<Sensitive>{f(breakdown.debtsIOwe)}</Sensitive>}
            tone="negative"
          />
        </div>
      </div>
    </>
  );
}
