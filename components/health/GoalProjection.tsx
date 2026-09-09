"use client";
import clsx from "clsx";
import { Target, CalendarCheck2 } from "lucide-react";
import type { CalorieTarget } from "@/lib/health/math";
import { weeksToGoal } from "@/lib/health/math";
import { formatWeight } from "@/lib/health/units";
import type { UnitsPreference } from "@/lib/health/units";

function fmtDate(weeks: number): string {
  const d = new Date();
  d.setDate(d.getDate() + Math.round(weeks * 7));
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fmtWeeks(weeks: number): string {
  if (weeks < 1) return `${Math.max(1, Math.round(weeks * 7))}d`;
  if (weeks < 12) return `${weeks.toFixed(1)} wk`;
  const months = weeks / 4.345;
  if (months < 24) return `${months.toFixed(1)} mo`;
  return `${(months / 12).toFixed(1)} yr`;
}

export function GoalProjection({
  currentKg,
  goalKg,
  targets,
  unitsPref,
}: {
  currentKg: number;
  goalKg: number;
  targets: CalorieTarget[];
  unitsPref: UnitsPreference;
}) {
  const delta = goalKg - currentKg;
  if (Math.abs(delta) < 0.1) {
    return (
      <p className="text-sm text-emerald-300">
        You&apos;re already at your goal — {formatWeight(goalKg, unitsPref)}. Nice.
      </p>
    );
  }

  // Direction-matching scenarios only.
  const direction = delta < 0 ? "loss" : "gain";
  const matching = targets.filter((t) => {
    if (direction === "loss") return t.weeklyKgChange < 0;
    return t.weeklyKgChange > 0;
  });

  const rows = matching
    .map((t) => {
      const w = weeksToGoal(currentKg, goalKg, t.weeklyKgChange);
      return w == null ? null : { target: t, weeks: w };
    })
    .filter((x): x is { target: CalorieTarget; weeks: number } => x !== null)
    .sort((a, b) => a.weeks - b.weeks);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm">
        <Target size={15} className="text-emerald-300" />
        <span className="text-neutral-300">
          From <strong className="text-neutral-100">{formatWeight(currentKg, unitsPref)}</strong>
          {" "}to{" "}
          <strong className="text-neutral-100">{formatWeight(goalKg, unitsPref)}</strong>
          {" "}
          <span className="text-neutral-500">
            ({direction === "loss" ? "lose" : "gain"}{" "}
            {formatWeight(Math.abs(delta), unitsPref)})
          </span>
        </span>
      </div>

      <ul className="max-w-3xl divide-y divide-white/[0.04] rounded-xl border border-white/5 overflow-hidden">
        {rows.map(({ target, weeks }) => {
          const recommended = target.goal.key === (direction === "loss" ? "moderate_loss" : "mild_gain");
          return (
            <li
              key={target.goal.key}
              className={clsx(
                "px-4 py-3 flex items-center justify-between gap-3 flex-wrap",
                recommended && "bg-emerald-500/[0.04]",
              )}
            >
              <div className="min-w-0">
                <div className="text-sm font-medium flex items-center gap-2">
                  {target.goal.label}
                  {recommended && (
                    <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border border-emerald-400/30 bg-emerald-500/10 text-emerald-200">
                      Recommended
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-neutral-500 tabular-nums mt-0.5">
                  {target.kcal.toLocaleString()} kcal/day
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <div className="text-sm font-semibold tabular-nums">{fmtWeeks(weeks)}</div>
                  <div className="text-[11px] text-neutral-500">to goal</div>
                </div>
                <div className="text-right flex items-center gap-1.5 text-neutral-400 text-xs">
                  <CalendarCheck2 size={13} />
                  <span className="tabular-nums">{fmtDate(weeks)}</span>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <p className="max-w-prose text-[11px] text-neutral-500 leading-relaxed">
        Estimates assume the calorie delta holds steady and use the standard ~7,700 kcal ≈ 1 kg
        body-weight conversion. Real progress depends on consistency, training, sleep, and a
        dozen other variables — treat these as a target lane, not a guarantee.
      </p>
    </div>
  );
}
