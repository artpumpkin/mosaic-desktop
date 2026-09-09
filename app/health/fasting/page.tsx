"use client";
import { useEffect, useState } from "react";
import { desc } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { useFinanceData } from "@/lib/query/useFinanceData";
import { useWide } from "@/lib/appLayout";
import {
  durationHours,
  formatDurationShort,
  type FastType,
} from "@/lib/health/fasting";
import GlassCard from "@/components/GlassCard";
import PageHeader from "@/components/PageHeader";
import PageSkeleton from "@/components/PageSkeleton";
import ErrorCard from "@/components/ErrorCard";
import {
  FastStartForm,
  FastActiveCard,
  FastLogForm,
  FastRow,
  type FastRowData,
} from "@/components/forms/health/FastingForms";
import { FastWeekStrip } from "@/components/health/FastWeekStrip";
import { Hourglass, History, ChevronDown, ChevronUp } from "lucide-react";

type FastingRow = typeof schema.fastingSessions.$inferSelect;
type PageData = { rows: FastingRow[] };

async function load(): Promise<PageData> {
  const rows = await db
    .select()
    .from(schema.fastingSessions)
    .orderBy(desc(schema.fastingSessions.startedAt));
  return { rows };
}

function toRowData(r: FastingRow): FastRowData {
  return {
    id: r.id,
    type: r.type as FastType,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    targetHours: r.targetHours,
    note: r.note,
  };
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

export default function FastingPage() {
  useWide(true);
  const { data, error, reload } = useFinanceData(["fasting"], load);
  const [showLog, setShowLog] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  if (error && !data) {
    return (
      <Shell>
        <PageHeader
          icon={Hourglass}
          title="Fasting"
          subtitle="Track OMAD, 24h, 48h, 72h, and longer fasts."
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
  const { rows } = data;

  const active = rows.find((r) => !r.endedAt) ?? null;
  const completed = rows.filter((r) => r.endedAt);

  const now = new Date(nowMs);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const thisMonth = completed.filter((r) => r.startedAt >= monthStart);

  const longest = completed.reduce((max, r) => {
    const h = durationHours(r.startedAt, r.endedAt);
    return h > max ? h : max;
  }, 0);

  const last5 = completed.slice(0, 5);
  const last5Avg =
    last5.length > 0
      ? last5.reduce((s, r) => s + durationHours(r.startedAt, r.endedAt), 0) /
        last5.length
      : 0;

  const subtitle =
    completed.length > 0
      ? `${completed.length} fasts logged · longest ${formatDurationShort(
          longest,
        )} · ${thisMonth.length} this month`
      : "Track OMAD, 24h, 48h, 72h, and longer fasts.";

  return (
    <Shell>
      <PageHeader icon={Hourglass} title="Fasting" subtitle={subtitle} />

      {(rows.length > 0 || active) && (
        <GlassCard className="!p-4">
          <div className="mx-auto w-full max-w-4xl">
            <FastWeekStrip rows={rows} now={nowMs} />
          </div>
        </GlassCard>
      )}

      {active && (
        <GlassCard padding={false} className="overflow-hidden mx-auto w-full max-w-3xl">
          <FastActiveCard row={toRowData(active)} />
        </GlassCard>
      )}

      {!active && (
        <GlassCard>
          <h2 className="font-medium mb-4">Start a fast</h2>
          <FastStartForm />
        </GlassCard>
      )}

      <GlassCard padding={false}>
        <button
          type="button"
          onClick={() => setShowLog((v) => !v)}
          className="w-full px-4 sm:px-5 py-3.5 flex items-center justify-between text-left hover:bg-white/[0.02] transition-colors rounded-2xl"
        >
          <span className="font-medium flex items-center gap-2">
            <History size={14} strokeWidth={2} className="text-violet-300" /> Log a
            past fast
          </span>
          {showLog ? (
            <ChevronUp size={14} className="text-neutral-500" />
          ) : (
            <ChevronDown size={14} className="text-neutral-500" />
          )}
        </button>
        {showLog && (
          <div className="px-4 sm:px-5 pb-5 pt-1 border-t border-white/5">
            <FastLogForm />
          </div>
        )}
      </GlassCard>

      {completed.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mx-auto w-full max-w-4xl">
          <Stat label="Total" value={completed.length.toString()} />
          <Stat label="Longest" value={formatDurationShort(longest)} />
          <Stat label="This month" value={thisMonth.length.toString()} />
          <Stat label="Last 5 avg" value={formatDurationShort(last5Avg)} />
        </div>
      )}

      <GlassCard padding={false}>
        <div className="px-4 sm:px-5 py-3.5 border-b border-white/5 flex items-center justify-between gap-3">
          <h2 className="font-medium">History</h2>
          <span className="text-[11px] uppercase tracking-wider text-neutral-500">
            {completed.length} completed
          </span>
        </div>
        {completed.length === 0 ? (
          <div className="py-10 text-center flex flex-col items-center gap-3">
            <span className="grid place-items-center w-12 h-12 rounded-xl bg-white/[0.02] border border-white/5 text-neutral-600">
              <Hourglass size={28} strokeWidth={1.75} />
            </span>
            <p className="text-sm text-neutral-400">No fasts logged yet.</p>
          </div>
        ) : (
          <div className="max-h-[28rem] overflow-y-auto">
            <ul className="divide-y divide-white/[0.04]">
              {completed.map((r) => (
                <FastRow key={r.id} row={toRowData(r)} />
              ))}
            </ul>
          </div>
        )}
      </GlassCard>
    </Shell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <GlassCard className="!p-4">
      <div className="text-xs text-neutral-400">{label}</div>
      <div className="text-2xl font-semibold tabular-nums mt-1">{value}</div>
    </GlassCard>
  );
}
