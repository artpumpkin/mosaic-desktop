"use client";
import clsx from "clsx";
import type { CalorieTarget } from "@/lib/health/math";
import { formatWeightDelta } from "@/lib/health/units";
import type { UnitsPreference } from "@/lib/health/units";

const TONE: Record<CalorieTarget["goal"]["tone"], { ring: string; text: string; chip: string; bg: string }> = {
  rose: {
    ring: "border-rose-400/40",
    text: "text-rose-300",
    chip: "bg-rose-500/15 border-rose-400/30 text-rose-200",
    bg: "from-rose-500/10",
  },
  amber: {
    ring: "border-amber-400/40",
    text: "text-amber-300",
    chip: "bg-amber-500/15 border-amber-400/30 text-amber-200",
    bg: "from-amber-500/10",
  },
  sky: {
    ring: "border-sky-400/40",
    text: "text-sky-300",
    chip: "bg-sky-500/15 border-sky-400/30 text-sky-200",
    bg: "from-sky-500/10",
  },
  emerald: {
    ring: "border-emerald-400/40",
    text: "text-emerald-300",
    chip: "bg-emerald-500/15 border-emerald-400/30 text-emerald-200",
    bg: "from-emerald-500/10",
  },
  cyan: {
    ring: "border-cyan-400/40",
    text: "text-cyan-300",
    chip: "bg-cyan-500/15 border-cyan-400/30 text-cyan-200",
    bg: "from-cyan-500/10",
  },
  violet: {
    ring: "border-violet-400/40",
    text: "text-violet-300",
    chip: "bg-violet-500/15 border-violet-400/30 text-violet-200",
    bg: "from-violet-500/10",
  },
};

function isActive(target: CalorieTarget, savedTargetKcal: number | null) {
  if (!savedTargetKcal) return false;
  return Math.abs(target.kcal - savedTargetKcal) <= 5;
}

export function CalorieTargetBar({
  targets,
  unitsPref,
  savedTargetKcal,
}: {
  targets: CalorieTarget[];
  unitsPref: UnitsPreference;
  savedTargetKcal: number | null;
}) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      {targets.map((t) => {
        const tone = TONE[t.goal.tone];
        const active = isActive(t, savedTargetKcal);
        return (
          <div
            key={t.goal.key}
            className={clsx(
              "relative overflow-hidden rounded-2xl p-4 border bg-gradient-to-br to-transparent transition-colors",
              tone.bg,
              active ? tone.ring : "border-white/5",
            )}
          >
            {active && (
              <span
                className={clsx(
                  "absolute top-2 right-2 text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border",
                  tone.chip,
                )}
              >
                Your target
              </span>
            )}
            <div className={clsx("text-[10px] uppercase tracking-[0.2em] font-medium", tone.text)}>
              {t.goal.label}
            </div>
            <div className="mt-2 text-2xl font-semibold tabular-nums">
              {t.kcal.toLocaleString()}
              <span className="text-xs text-neutral-500 font-normal ml-1">kcal</span>
            </div>
            <div className="mt-1 text-[11px] text-neutral-500 tabular-nums">
              {t.goal.deltaKcal === 0
                ? "± 0 kcal/day"
                : `${t.goal.deltaKcal > 0 ? "+" : "−"}${Math.abs(t.goal.deltaKcal)} kcal/day`}
            </div>
            <div className={clsx("mt-2 text-xs tabular-nums", tone.text)}>
              {t.weeklyKgChange === 0
                ? "Hold steady"
                : `${formatWeightDelta(t.weeklyKgChange, unitsPref)} / wk`}
            </div>
            <p className="mt-2 text-[11px] text-neutral-400 leading-snug">{t.goal.blurb}</p>
          </div>
        );
      })}
    </div>
  );
}
