"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { desc } from "drizzle-orm";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  ResponsiveContainer,
} from "recharts";
import { useWide } from "@/lib/appLayout";
import { db, schema } from "@/lib/db/client";
import { computeNetWorth, type Breakdown } from "@/lib/refresh";
import { fmtBase, toMad, type FxTable } from "@/lib/format";
import { getFxToMad } from "@/lib/integrations/fx";
import {
  getBaseCurrency,
  getHealthProfile,
  getUnitsPreference,
  type BaseCurrency,
  type HealthProfile,
} from "@/lib/settings";
import { useFinanceData } from "@/lib/query/useFinanceData";
import { calcAgeYears, calcBmr, calcTdee, calcBmi } from "@/lib/health/math";
import { dailyAverages, latestEntry, recentAverage } from "@/lib/health/stats";
import { formatWeight, formatWeightDelta } from "@/lib/health/units";
import type { UnitsPreference } from "@/lib/health/units";
import GlassCard from "@/components/GlassCard";
import Sensitive from "@/components/Sensitive";
import ErrorCard from "@/components/ErrorCard";
import ContinueRail from "@/components/dashboard/ContinueRail";
import {
  TrendingUp,
  TrendingDown,
  ArrowUpRight,
  Scale,
  Flame,
  Activity,
  CandlestickChart,
  ChevronRight,
  Sparkles,
  Receipt,
  HandCoins,
  type LucideIcon,
} from "lucide-react";
import clsx from "clsx";

type RecentItem =
  | { kind: "weight"; ts: number; date: string; weightKg: number }
  | { kind: "expense"; ts: number; date: string; category: string; amount: number; currency: string }
  | { kind: "income"; ts: number; date: string; source: string; amount: number; currency: string };

type DashData = {
  totalMad: number;
  breakdown: Breakdown;
  base: BaseCurrency;
  fx: FxTable;
  latestWeightKg: number | null;
  latestWeightAt: string | null;
  weight5Avg: number | null;
  weightSeries: { d: number; v: number }[];
  spendSeries: { d: number; v: number }[];
  tdee: number;
  recommendedTarget: number;
  profile: HealthProfile;
  unitsPref: UnitsPreference;
  recent: RecentItem[];
  weightStreak: number;
};

const DAY = 86_400_000;

function startOfLocalDay(d: Date): number {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c.getTime();
}

function computeWeightStreak(weights: { recordedAt: string }[]): number {
  const days = new Set<number>();
  for (const w of weights) days.add(startOfLocalDay(new Date(w.recordedAt)));
  let streak = 0;
  let cursor = startOfLocalDay(new Date());
  // tolerate "didn't log today yet" — start from yesterday if today missing
  if (!days.has(cursor)) cursor -= DAY;
  while (days.has(cursor)) {
    streak++;
    cursor -= DAY;
  }
  return streak;
}

async function load(): Promise<DashData> {
  const [
    net,
    base,
    fx,
    weights,
    expenses,
    incomes,
    profile,
    unitsPref,
  ] = await Promise.all([
    computeNetWorth(),
    getBaseCurrency(),
    getFxToMad().catch(() => ({ MAD: 1 }) as FxTable),
    db
      .select()
      .from(schema.weightEntries)
      .orderBy(desc(schema.weightEntries.recordedAt)),
    db
      .select()
      .from(schema.expenses)
      .orderBy(desc(schema.expenses.occurredOn), desc(schema.expenses.id))
      .limit(20),
    db
      .select()
      .from(schema.incomes)
      .orderBy(desc(schema.incomes.occurredOn), desc(schema.incomes.id))
      .limit(20),
    getHealthProfile(),
    getUnitsPreference(),
  ]);

  const latest = latestEntry(weights);
  const avg5 = recentAverage(weights, 5);

  // Weight series (last 30 days, daily averages, kg)
  const daily = dailyAverages(weights);
  const today0 = startOfLocalDay(new Date());
  const weightSeries: { d: number; v: number }[] = [];
  let lastSeen = avg5 ?? latest?.weightKg ?? 0;
  for (let i = 29; i >= 0; i--) {
    const day = today0 - i * DAY;
    const v = daily.get(day);
    if (v !== undefined) lastSeen = v;
    if (lastSeen > 0) weightSeries.push({ d: day, v: lastSeen });
  }

  // Spend series (last 30 days, summed per day in base currency MAD-equivalent)
  const spendByDay = new Map<number, number>();
  for (const e of expenses) {
    const d = startOfLocalDay(new Date(e.occurredOn));
    spendByDay.set(d, (spendByDay.get(d) ?? 0) + toMad(e.amount, e.currency, fx));
  }
  const spendSeries: { d: number; v: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const day = today0 - i * DAY;
    spendSeries.push({ d: day, v: spendByDay.get(day) ?? 0 });
  }

  let tdee = 0;
  if (latest && profile.heightCm && profile.dateOfBirth) {
    const bmr = calcBmr({
      gender: profile.gender,
      weightKg: latest.weightKg,
      heightCm: profile.heightCm,
      ageYears: calcAgeYears(profile.dateOfBirth),
    });
    tdee = Math.round(calcTdee(bmr, profile.activityLevel));
  }
  const recommendedTarget =
    profile.dailyCalorieTarget ?? (tdee > 0 ? Math.max(0, tdee - 500) : 0);

  const recent: RecentItem[] = [];
  for (const w of weights.slice(0, 10)) {
    recent.push({
      kind: "weight",
      ts: new Date(w.recordedAt).getTime(),
      date: w.recordedAt,
      weightKg: w.weightKg,
    });
  }
  for (const e of expenses.slice(0, 10)) {
    recent.push({
      kind: "expense",
      ts: new Date(e.occurredOn).getTime(),
      date: e.occurredOn,
      category: e.category,
      amount: e.amount,
      currency: e.currency,
    });
  }
  for (const i of incomes.slice(0, 10)) {
    recent.push({
      kind: "income",
      ts: new Date(i.occurredOn).getTime(),
      date: i.occurredOn,
      source: i.source,
      amount: i.amount,
      currency: i.currency,
    });
  }
  recent.sort((a, b) => b.ts - a.ts);

  return {
    totalMad: net.totalMad,
    breakdown: net.breakdown,
    base,
    fx,
    latestWeightKg: latest?.weightKg ?? null,
    latestWeightAt: latest?.recordedAt ?? null,
    weight5Avg: avg5,
    weightSeries,
    spendSeries,
    tdee,
    recommendedTarget,
    profile,
    unitsPref,
    recent: recent.slice(0, 8),
    weightStreak: computeWeightStreak(weights),
  };
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Burning the midnight oil";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  if (h < 22) return "Good evening";
  return "Good night";
}

export default function MosaicDashboard() {
  useWide(true);
  const { data, error, reload } = useFinanceData(
    ["dashboard", "weight", "health-profile", "settings"],
    load,
  );

  // Live clock so the greeting updates as the day passes (without a refetch).
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const greet = useMemo(() => {
    void now;
    return greeting();
  }, [now]);

  if (!data) {
    return (
      <Shell>
        {error ? (
          <ErrorCard message={error} onRetry={reload} />
        ) : (
          <div className="space-y-8 animate-pulse">
            {/* greeting hero band */}
            <div className="h-28 rounded-2xl bg-white/[0.03] border border-white/5" />
            {/* continue rail height */}
            <div className="h-40 rounded-2xl bg-white/[0.03] border border-white/5" />
            {/* two domain cards + recent activity (mirrors loaded layout) */}
            <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-6 items-start">
              <div className="h-64 rounded-2xl bg-white/[0.03] border border-white/5" />
              <div className="h-64 rounded-2xl bg-white/[0.03] border border-white/5" />
              <div className="h-72 rounded-2xl bg-white/[0.03] border border-white/5 lg:col-span-2 2xl:col-span-1" />
            </div>
          </div>
        )}
      </Shell>
    );
  }

  const f = (mad: number) => fmtBase(mad, data.base, data.fx);
  const bmi =
    data.latestWeightKg && data.profile.heightCm
      ? calcBmi(data.latestWeightKg, data.profile.heightCm)
      : null;
  const weightDelta =
    data.latestWeightKg && data.weight5Avg
      ? data.latestWeightKg - data.weight5Avg
      : null;
  const todayLabel = now.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <Shell>
      {/* Greeting hero */}
      <GlassCard className="relative overflow-hidden">
        <div
          aria-hidden
          className="absolute -top-24 -right-24 w-80 h-80 rounded-full opacity-40 pointer-events-none"
          style={{
            background:
              "radial-gradient(circle, rgba(168,85,247,0.55), transparent 70%)",
          }}
        />
        <div
          aria-hidden
          className="absolute -bottom-32 -left-20 w-80 h-80 rounded-full opacity-30 pointer-events-none"
          style={{
            background:
              "radial-gradient(circle, rgba(16,185,129,0.5), transparent 70%)",
          }}
        />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.22em] text-violet-300/80">
              <Sparkles size={13} />
              {todayLabel}
            </div>
            <h1 className="mt-2 text-3xl sm:text-4xl font-semibold tracking-tight gradient-text">
              {greet}.
            </h1>
            <p className="mt-1 text-sm text-neutral-400 max-w-2xl">
              {summaryLine(data)}
            </p>
          </div>
          {data.weightStreak > 0 && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-emerald-400/30 bg-emerald-500/10 text-emerald-200 text-xs">
              <Flame size={13} />
              <span className="font-medium tabular-nums">{data.weightStreak}</span>
              <span>day weigh-in streak</span>
            </div>
          )}
        </div>
      </GlassCard>

      {/* Continue watching / reading across all media (client-hydrated;
          renders nothing until there's something in progress). */}
      <ContinueRail />

      {/* Domain cards + recent activity — paired cards on xl, and on
          ultrawide (2xl) the recent-activity panel joins as a third column
          so the extra width adds density instead of stretching the cards. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-6 items-start">
        <DomainCard
          href="/finance"
          accent="violet"
          icon={CandlestickChart}
          title="Finance"
          headlineValue={<Sensitive>{f(data.totalMad)}</Sensitive>}
          headlineCaption="Total net worth"
          chartData={data.spendSeries}
          chartType="bar"
          chartTone="rose"
          actions={
            <>
              <QuickAction href="/finance/expenses" icon={Receipt} label="Log expense" tint="violet" />
              <QuickAction href="/finance/income" icon={HandCoins} label="Log income" tint="violet" />
            </>
          }
        >
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
            <span className="flex items-center gap-1.5 text-emerald-300">
              <TrendingUp size={14} />
              <span className="text-neutral-400">Income MTD</span>
              <span className="font-medium tabular-nums"><Sensitive>{f(data.breakdown.income)}</Sensitive></span>
            </span>
            <span className="flex items-center gap-1.5 text-rose-300">
              <TrendingDown size={14} />
              <span className="text-neutral-400">Spent MTD</span>
              <span className="font-medium tabular-nums">
                <Sensitive>{f(data.breakdown.expensesThisMonth)}</Sensitive>
              </span>
            </span>
          </div>
        </DomainCard>

        <DomainCard
          href="/health"
          accent="emerald"
          icon={Activity}
          title="Health"
          headlineValue={
            data.latestWeightKg
              ? formatWeight(data.latestWeightKg, data.unitsPref)
              : "—"
          }
          headlineCaption={
            data.latestWeightAt
              ? `Last logged ${new Date(data.latestWeightAt).toLocaleDateString()}`
              : "No weight logged yet"
          }
          chartData={data.weightSeries}
          chartType="area"
          chartTone="emerald"
          actions={
            <>
              <QuickAction href="/health/weight" icon={Scale} label="Log weight" tint="emerald" />
              <QuickAction href="/health/metabolism" icon={Flame} label="Metabolism" tint="emerald" />
            </>
          }
        >
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
            {weightDelta != null && (
              <span className="flex items-center gap-1.5">
                <Scale size={14} className="text-emerald-300" />
                <span className="text-neutral-400">vs 5-day</span>
                <span
                  className={clsx(
                    "font-medium tabular-nums",
                    weightDelta > 0
                      ? "text-rose-300"
                      : weightDelta < 0
                        ? "text-emerald-300"
                        : "text-neutral-300",
                  )}
                >
                  {formatWeightDelta(weightDelta, data.unitsPref)}
                </span>
              </span>
            )}
            {bmi && (
              <span className="flex items-center gap-1.5">
                <Activity size={14} className="text-emerald-300" />
                <span className="text-neutral-400">BMI</span>
                <span className="font-medium tabular-nums">{bmi.value.toFixed(1)}</span>
              </span>
            )}
            {data.tdee > 0 && (
              <span className="flex items-center gap-1.5">
                <Flame size={14} className="text-emerald-300" />
                <span className="text-neutral-400">TDEE</span>
                <span className="font-medium tabular-nums">
                  {data.tdee.toLocaleString()}
                </span>
                <span className="text-xs text-neutral-500">
                  · target {data.recommendedTarget.toLocaleString()}
                </span>
              </span>
            )}
          </div>
        </DomainCard>

        {/* Recent activity — full width below the two cards on small/medium,
            sits as the third column on ultrawide. */}
        <GlassCard padding={false} className="lg:col-span-2 2xl:col-span-1 self-stretch">
        <div className="px-4 sm:px-5 py-3.5 border-b border-white/5 flex items-center justify-between">
          <h2 className="font-medium">Recent activity</h2>
          <span className="text-[11px] uppercase tracking-wider text-neutral-500">
            across all trackers
          </span>
        </div>
        {data.recent.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-neutral-400">
            Nothing logged yet — try a quick action above.
          </p>
        ) : (
          <div className="max-h-[28rem] overflow-y-auto">
            <ul className="divide-y divide-white/[0.04]">
              {data.recent.map((r, i) => (
                <RecentRow
                  key={`${r.kind}-${r.ts}-${i}`}
                  item={r}
                  unitsPref={data.unitsPref}
                />
              ))}
            </ul>
          </div>
        )}
        </GlassCard>
      </div>
    </Shell>
  );
}

// Full-pane shell — scroll zone is edge-to-edge under the sidebar, content
// capped to a readable column.
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

// ---------- subcomponents ----------------------------------------------

function summaryLine(d: DashData): string {
  const bits: string[] = [];
  if (d.latestWeightKg) {
    bits.push(`weight at ${formatWeight(d.latestWeightKg, d.unitsPref)}`);
  }
  if (d.totalMad) {
    bits.push(`net worth tracked across ${countSources(d.breakdown)} sources`);
  }
  if (d.tdee > 0) {
    bits.push(`TDEE ${d.tdee.toLocaleString()} kcal`);
  }
  if (bits.length === 0) {
    return "Start tracking — log a weight, an expense, anything.";
  }
  return `Today: ${bits.join(" · ")}.`;
}

function countSources(b: Breakdown): number {
  let n = 0;
  if (b.banksMad > 0 || b.banksAed > 0 || b.banksOther > 0) n++;
  if (b.cash > 0) n++;
  if (b.exchanges > 0) n++;
  if (b.ethWallets > 0) n++;
  if (b.assets > 0) n++;
  return n || 1;
}

function DomainCard({
  href,
  accent,
  icon: Icon,
  title,
  headlineValue,
  headlineCaption,
  chartData,
  chartType,
  chartTone,
  actions,
  children,
}: {
  href: string;
  accent: "emerald" | "violet";
  icon: LucideIcon;
  title: string;
  headlineValue: React.ReactNode;
  headlineCaption: string;
  chartData: { d: number; v: number }[];
  chartType: "area" | "bar";
  chartTone: "emerald" | "rose";
  actions: React.ReactNode;
  children: React.ReactNode;
}) {
  const accentText = accent === "emerald" ? "text-emerald-300/80" : "text-violet-300/80";
  const headlineGradient =
    accent === "emerald"
      ? "bg-gradient-to-r from-emerald-300 via-teal-300 to-cyan-300"
      : "bg-gradient-to-r from-violet-300 via-fuchsia-300 to-cyan-300";
  const chartColor = chartTone === "emerald" ? "#10b981" : "#f43f5e";
  return (
    <GlassCard hover className="group h-full relative overflow-hidden flex flex-col">
      <Link href={href} className="block">
        <div className="flex items-center justify-between mb-3">
          <div className={`flex items-center gap-2 text-xs uppercase tracking-wider ${accentText}`}>
            <Icon size={14} /> {title}
          </div>
          <ChevronRight
            size={16}
            className="text-neutral-500 group-hover:text-neutral-200 group-hover:translate-x-0.5 transition-all"
          />
        </div>
        <div
          className={`text-4xl sm:text-5xl font-semibold tracking-tight tabular-nums break-words ${headlineGradient} bg-clip-text text-transparent`}
        >
          {headlineValue}
        </div>
        <div className="text-xs text-neutral-500 mt-1">{headlineCaption}</div>

        <div className="mt-4">{children}</div>
      </Link>

      {/* Quick actions for this domain */}
      <div className="mt-4 pt-3 border-t border-white/5 grid grid-cols-2 gap-3">
        {actions}
      </div>

      {chartData.length > 1 && (
        <div className="h-16 lg:h-20 xl:h-24 -mx-5 md:-mx-6 -mb-5 md:-mb-6 mt-4 opacity-90">
            <ResponsiveContainer width="100%" height="100%">
              {chartType === "area" ? (
                <AreaChart data={chartData} margin={{ top: 6, right: 0, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id={`fill-${accent}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={chartColor} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={chartColor} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Area
                    type="monotone"
                    dataKey="v"
                    stroke={chartColor}
                    strokeWidth={1.75}
                    fill={`url(#fill-${accent})`}
                  />
                </AreaChart>
              ) : (
                <BarChart data={chartData} margin={{ top: 6, right: 0, bottom: 0, left: 0 }}>
                  <Bar dataKey="v" fill={chartColor} radius={[2, 2, 0, 0]} />
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>
        )}
      </GlassCard>
  );
}

function QuickAction({
  href,
  icon: Icon,
  label,
  tint,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  tint: "emerald" | "violet";
}) {
  const tintCls =
    tint === "emerald"
      ? "text-emerald-300 group-hover:text-emerald-200"
      : "text-violet-300 group-hover:text-violet-200";
  return (
    <Link
      href={href}
      className="group flex items-center justify-between gap-2 rounded-xl border border-white/5 bg-white/[0.02] px-4 py-3 text-sm hover:bg-white/[0.05] hover:border-white/10 transition-all"
    >
      <span className="flex items-center gap-2.5">
        <Icon size={15} className={tintCls + " transition-colors"} />
        <span>{label}</span>
      </span>
      <ArrowUpRight
        size={14}
        className="text-neutral-500 group-hover:text-neutral-300 group-hover:translate-x-0.5 transition-all"
      />
    </Link>
  );
}

function RecentRow({
  item,
  unitsPref,
}: {
  item: RecentItem;
  unitsPref: UnitsPreference;
}) {
  const time = new Date(item.date).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  if (item.kind === "weight") {
    return (
      <li className="px-4 sm:px-5 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <IconChip icon={Scale} tint="emerald" />
          <div className="min-w-0">
            <div className="text-sm">
              <span className="text-neutral-400">Weight</span>{" "}
              <span className="tabular-nums">{formatWeight(item.weightKg, unitsPref)}</span>
            </div>
            <div className="text-[11px] text-neutral-500">{time}</div>
          </div>
        </div>
      </li>
    );
  }
  if (item.kind === "expense") {
    return (
      <li className="px-4 sm:px-5 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <IconChip icon={TrendingDown} tint="rose" />
          <div className="min-w-0">
            <div className="text-sm">
              <span className="text-neutral-400">{item.category}</span>{" "}
              <Sensitive className="tabular-nums text-rose-300">
                −{item.amount.toLocaleString()} {item.currency}
              </Sensitive>
            </div>
            <div className="text-[11px] text-neutral-500">{time}</div>
          </div>
        </div>
      </li>
    );
  }
  return (
    <li className="px-4 sm:px-5 py-3 flex items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <IconChip icon={TrendingUp} tint="emerald" />
        <div className="min-w-0">
          <div className="text-sm">
            <span className="text-neutral-400">{item.source}</span>{" "}
            <Sensitive className="tabular-nums text-emerald-300">
              +{item.amount.toLocaleString()} {item.currency}
            </Sensitive>
          </div>
          <div className="text-[11px] text-neutral-500">{time}</div>
        </div>
      </div>
    </li>
  );
}

function IconChip({
  icon: Icon,
  tint,
}: {
  icon: LucideIcon;
  tint: "emerald" | "violet" | "rose";
}) {
  const colors = {
    emerald: "text-emerald-300 bg-emerald-500/10 border-emerald-400/20",
    violet: "text-violet-300 bg-violet-500/10 border-violet-400/20",
    rose: "text-rose-300 bg-rose-500/10 border-rose-400/20",
  } as const;
  return (
    <span
      className={`grid place-items-center shrink-0 w-8 h-8 rounded-lg border ${colors[tint]}`}
    >
      <Icon size={14} />
    </span>
  );
}
