"use client";
import clsx from "clsx";
import {
  durationHours,
  formatDurationShort,
  stageForHours,
} from "@/lib/health/fasting";

type Row = {
  startedAt: string;
  endedAt: string | null;
};

const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function FastWeekStrip({ rows, now }: { rows: Row[]; now: number }) {
  const today = startOfDay(new Date(now));
  const days: Date[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    days.push(d);
  }

  // For each day, find the longest fast that *finished* that day (or is ongoing today).
  const stats = days.map((day) => {
    const dayStart = day.getTime();
    const dayEnd = dayStart + 86_400_000;
    let longest = 0;
    let hadFast = false;
    for (const r of rows) {
      const endMs = r.endedAt ? new Date(r.endedAt).getTime() : now;
      if (endMs >= dayStart && endMs < dayEnd) {
        const h = durationHours(r.startedAt, r.endedAt, now);
        if (h > longest) longest = h;
        hadFast = true;
      }
    }
    return { day, hours: longest, hadFast };
  });

  const streak = (() => {
    let n = 0;
    for (let i = stats.length - 1; i >= 0; i--) {
      if (stats[i].hadFast) n++;
      else break;
    }
    return n;
  })();

  return (
    <div className="flex items-center gap-1.5 sm:gap-2 justify-between">
      {stats.map((s, i) => {
        const isToday = i === stats.length - 1;
        const stage = s.hours > 0 ? stageForHours(s.hours) : null;
        const ratio = Math.min(1, s.hours / 24);
        const size = 36;
        const stroke = 3.5;
        const radius = (size - stroke) / 2;
        const c = 2 * Math.PI * radius;
        const dash = ratio * c;
        return (
          <div
            key={i}
            className={clsx(
              "flex-1 flex flex-col items-center gap-1 py-1.5 rounded-lg transition-colors",
              isToday && "bg-white/[0.03]",
            )}
            title={`${DAY_NAMES[s.day.getDay()]} ${s.day.getDate()} · ${
              s.hours > 0 ? formatDurationShort(s.hours) : "no fast"
            }`}
          >
            <span
              className={clsx(
                "text-[10px] uppercase tracking-wider",
                isToday ? "text-violet-300" : "text-neutral-500",
              )}
            >
              {DAY_LABELS[s.day.getDay()]}
            </span>
            <div className="relative" style={{ width: size, height: size }}>
              <svg width={size} height={size} className="-rotate-90">
                <circle
                  cx={size / 2}
                  cy={size / 2}
                  r={radius}
                  stroke="rgba(255,255,255,0.06)"
                  strokeWidth={stroke}
                  fill="none"
                />
                {stage && (
                  <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    stroke={stage.ringColor}
                    strokeWidth={stroke}
                    fill="none"
                    strokeDasharray={`${dash} ${c}`}
                    strokeLinecap="round"
                  />
                )}
              </svg>
              <div className="absolute inset-0 flex items-center justify-center text-[11px]">
                {stage ? (
                  <span aria-hidden>{stage.emoji}</span>
                ) : (
                  <span className="text-neutral-700">·</span>
                )}
              </div>
            </div>
            <span className="text-[10px] text-neutral-500 tabular-nums">
              {s.hours > 0 ? formatDurationShort(s.hours) : "—"}
            </span>
          </div>
        );
      })}
      {streak > 0 && (
        <div className="ml-1 flex flex-col items-center gap-0.5 px-2 py-1 rounded-lg bg-gradient-to-br from-amber-500/15 to-rose-500/10 border border-amber-400/20">
          <span className="text-base leading-none" aria-hidden>🔥</span>
          <span className="text-xs font-semibold tabular-nums text-amber-200">{streak}</span>
          <span className="text-[9px] uppercase tracking-wider text-amber-300/70">streak</span>
        </div>
      )}
    </div>
  );
}
