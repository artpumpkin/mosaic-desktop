"use client";
import { useState } from "react";
import { desc } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { useWide } from "@/lib/appLayout";
import { getHealthProfile, getUnitsPreference, type HealthProfile } from "@/lib/settings";
import { useFinanceData } from "@/lib/query/useFinanceData";
import type { UnitsPreference } from "@/lib/health/units";
import { formatWeight, formatWeightDelta } from "@/lib/health/units";
import { latestEntry, recentAverage } from "@/lib/health/stats";
import GlassCard from "@/components/GlassCard";
import PageHeader from "@/components/PageHeader";
import PageSkeleton from "@/components/PageSkeleton";
import EmptyState from "@/components/EmptyState";
import ErrorCard from "@/components/ErrorCard";
import { BmiCard } from "@/components/health/BmiCard";
import { WeightChart } from "@/components/health/WeightChart";
import {
  WeightCreateForm,
  WeightRow,
  type WeightRowData,
} from "@/components/forms/health/WeightForms";
import { Scale } from "lucide-react";
import clsx from "clsx";

type PageData = {
  entries: WeightRowData[];
  profile: HealthProfile;
  unitsPref: UnitsPreference;
};

async function load(): Promise<PageData> {
  const [entries, profile, unitsPref] = await Promise.all([
    db
      .select()
      .from(schema.weightEntries)
      .orderBy(desc(schema.weightEntries.recordedAt)),
    getHealthProfile(),
    getUnitsPreference(),
  ]);
  return { entries, profile, unitsPref };
}

const RANGES: { label: string; days: number | null }[] = [
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
  { label: "All", days: null },
];

export default function WeightPage() {
  useWide(true);
  const { data, error, reload } = useFinanceData(
    ["weight", "health-profile", "settings"],
    load,
  );
  const [range, setRange] = useState<(typeof RANGES)[number]>(RANGES[0]);

  return (
    <div className="h-screen flex flex-col bg-[var(--background)] overflow-hidden">
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="w-full px-4 md:px-6 py-5 md:py-8 space-y-8">
          <PageHeader
            icon={Scale}
            title="Weight"
            subtitle="Log your weight; 5- and 10-day moving averages smooth the noise."
          />

          {error ? (
            <ErrorCard message={error} onRetry={reload} />
          ) : !data ? (
            <PageSkeleton />
          ) : (
            <WeightContent data={data} range={range} setRange={setRange} />
          )}
        </div>
      </div>
    </div>
  );
}

function WeightContent({
  data,
  range,
  setRange,
}: {
  data: PageData;
  range: (typeof RANGES)[number];
  setRange: (r: (typeof RANGES)[number]) => void;
}) {
  const { entries, profile, unitsPref } = data;

  const latest = latestEntry(entries);
  const avg5 = recentAverage(entries, 5);
  const avg10 = recentAverage(entries, 10);
  const delta = latest && avg5 ? latest.weightKg - avg5 : null;

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6 gap-4">
        <GlassCard>
          <div className="text-xs text-neutral-400 mb-1.5">Current</div>
          <div className="text-3xl font-semibold tabular-nums">
            {latest ? formatWeight(latest.weightKg, unitsPref) : "—"}
          </div>
          {latest && (
            <div className="text-[11px] text-neutral-500 mt-1">
              {new Date(latest.recordedAt).toLocaleString()}
            </div>
          )}
        </GlassCard>
        <GlassCard>
          <div className="text-xs text-neutral-400 mb-1.5">5-day avg</div>
          <div className="text-3xl font-semibold tabular-nums">
            {avg5 != null ? formatWeight(avg5, unitsPref) : "—"}
          </div>
          {delta != null && (
            <div
              className={clsx(
                "text-[11px] mt-1 tabular-nums",
                delta > 0
                  ? "text-rose-300"
                  : delta < 0
                    ? "text-emerald-300"
                    : "text-neutral-500",
              )}
            >
              {formatWeightDelta(delta, unitsPref)} vs avg
            </div>
          )}
        </GlassCard>
        <GlassCard>
          <div className="text-xs text-neutral-400 mb-1.5">10-day avg</div>
          <div className="text-3xl font-semibold tabular-nums">
            {avg10 != null ? formatWeight(avg10, unitsPref) : "—"}
          </div>
        </GlassCard>
        <GlassCard className="col-span-2 sm:col-span-3 lg:col-span-1 2xl:col-span-3">
          <div className="text-xs text-neutral-400 mb-2">Body mass index</div>
          <BmiCard weightKg={latest?.weightKg ?? null} heightCm={profile.heightCm} />
        </GlassCard>
      </div>

      <GlassCard>
        <h2 className="font-medium mb-4">Log a weight</h2>
        <div className="max-w-3xl">
          <WeightCreateForm unitsPref={unitsPref} />
        </div>
      </GlassCard>

      <div className="grid gap-6 xl:grid-cols-2 items-start">
      <GlassCard>
        <div className="flex items-center justify-between mb-4 gap-3">
          <h2 className="font-medium">Trend</h2>
          <div className="flex gap-1 shrink-0">
            {RANGES.map((r) => (
              <button
                key={r.label}
                type="button"
                onClick={() => setRange(r)}
                className={clsx(
                  "px-2.5 py-1 rounded-lg text-xs border",
                  range.label === r.label
                    ? "bg-emerald-500/15 border-emerald-400/30 text-emerald-200"
                    : "bg-white/[0.02] border-white/5 text-neutral-400 hover:bg-white/[0.05] hover:text-neutral-200",
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
        <WeightChart
          entries={entries}
          unitsPref={unitsPref}
          rangeDays={range.days}
          heightClass="h-56 sm:h-64 lg:h-72"
        />
      </GlassCard>

      {entries.length === 0 ? (
        <EmptyState
          icon={Scale}
          title="No entries yet — log a weight above."
        />
      ) : (
        <GlassCard padding={false}>
          <div className="px-4 sm:px-5 py-3.5 border-b border-white/5 flex items-center justify-between gap-3">
            <h2 className="font-medium">History</h2>
            <span className="text-[11px] uppercase tracking-wider text-neutral-500">
              {entries.length} {entries.length === 1 ? "entry" : "entries"}
            </span>
          </div>
          <ul className="divide-y divide-white/[0.04] max-h-[28rem] overflow-y-auto">
            {entries.map((e) => (
              <li key={e.id} className="px-4 sm:px-5 py-3">
                <WeightRow row={e} unitsPref={unitsPref} />
              </li>
            ))}
          </ul>
        </GlassCard>
      )}
      </div>
    </>
  );
}
