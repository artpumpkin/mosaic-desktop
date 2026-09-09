"use client";
import { useMemo } from "react";
import clsx from "clsx";
import { calcBmi, type BmiCategory } from "@/lib/health/math";
import { formatWeight, kgToLb, weightUnitLabel } from "@/lib/health/units";
import type { UnitsPreference } from "@/lib/health/units";

const SCALE_MIN = 14;
const SCALE_MAX = 40;
const SCALE_SPAN = SCALE_MAX - SCALE_MIN;

const BANDS: { from: number; to: number; key: BmiCategory; label: string; color: string }[] = [
  { from: 14, to: 18.5, key: "underweight", label: "Underweight", color: "from-sky-400/70 to-sky-500/70" },
  { from: 18.5, to: 25, key: "normal", label: "Normal", color: "from-emerald-400/70 to-emerald-500/70" },
  { from: 25, to: 30, key: "overweight", label: "Overweight", color: "from-amber-400/70 to-amber-500/70" },
  { from: 30, to: 40, key: "obese", label: "Obese", color: "from-rose-400/70 to-rose-500/70" },
];

const CATEGORY_TEXT: Record<BmiCategory, string> = {
  underweight: "text-sky-300",
  normal: "text-emerald-300",
  overweight: "text-amber-300",
  obese: "text-rose-300",
};

const CATEGORY_PILL: Record<BmiCategory, string> = {
  underweight: "text-sky-300 bg-sky-500/10 border-sky-400/30",
  normal: "text-emerald-300 bg-emerald-500/10 border-emerald-400/30",
  overweight: "text-amber-300 bg-amber-500/10 border-amber-400/30",
  obese: "text-rose-300 bg-rose-500/10 border-rose-400/30",
};

function pct(value: number): number {
  const clamped = Math.max(SCALE_MIN, Math.min(SCALE_MAX, value));
  return ((clamped - SCALE_MIN) / SCALE_SPAN) * 100;
}

function healthyWeightRange(heightCm: number): { minKg: number; maxKg: number } {
  const m = heightCm / 100;
  return { minKg: 18.5 * m * m, maxKg: 24.9 * m * m };
}

export function BmiVisualizer({
  weightKg,
  heightCm,
  goalWeightKg,
  unitsPref,
  compact = false,
}: {
  weightKg: number | null;
  heightCm: number | null;
  goalWeightKg?: number | null;
  unitsPref: UnitsPreference;
  compact?: boolean;
}) {
  const bmi = useMemo(() => {
    if (!weightKg || !heightCm) return null;
    return calcBmi(weightKg, heightCm);
  }, [weightKg, heightCm]);

  const healthy = useMemo(() => (heightCm ? healthyWeightRange(heightCm) : null), [heightCm]);

  if (!bmi || !weightKg || !heightCm || !healthy) {
    return (
      <div className="text-sm text-neutral-500 py-6 text-center">
        Enter a height and weight to see the BMI visualizer.
      </div>
    );
  }

  const markerPct = pct(bmi.value);
  const toMinDelta = weightKg - healthy.minKg;
  const toMaxDelta = weightKg - healthy.maxKg;
  let inRangeMsg: React.ReactNode;
  if (weightKg < healthy.minKg) {
    inRangeMsg = (
      <>
        <span className="text-sky-300 tabular-nums">
          +{formatWeight(healthy.minKg - weightKg, unitsPref)}
        </span>{" "}
        to reach the lower edge of &quot;normal&quot;.
      </>
    );
  } else if (weightKg > healthy.maxKg) {
    inRangeMsg = (
      <>
        <span className="text-rose-300 tabular-nums">
          −{formatWeight(weightKg - healthy.maxKg, unitsPref)}
        </span>{" "}
        to enter &quot;normal&quot;.
      </>
    );
  } else {
    inRangeMsg = <>You&apos;re inside the healthy range.</>;
  }

  const goalDelta =
    goalWeightKg && goalWeightKg > 0 ? weightKg - goalWeightKg : null;

  return (
    <div className="space-y-5">
      {/* Headline */}
      <div className="flex items-baseline gap-3 flex-wrap">
        <span className={clsx("text-5xl font-semibold tabular-nums", CATEGORY_TEXT[bmi.category])}>
          {bmi.value.toFixed(1)}
        </span>
        <span
          className={clsx(
            "px-2.5 py-1 rounded-md text-xs uppercase tracking-wider border",
            CATEGORY_PILL[bmi.category],
          )}
        >
          {bmi.category}
        </span>
        <span className="text-xs text-neutral-500">
          {unitsPref === "imperial"
            ? `${kgToLb(weightKg).toFixed(1)} lb @ ${heightCm.toFixed(0)} cm`
            : `${weightKg.toFixed(1)} kg @ ${heightCm.toFixed(0)} cm`}
        </span>
      </div>

      {/* Scale */}
      <div className="relative">
        <div className="flex h-3 rounded-full overflow-hidden">
          {BANDS.map((b) => {
            const widthPct = ((b.to - b.from) / SCALE_SPAN) * 100;
            return (
              <div
                key={b.key}
                className={clsx("h-full bg-gradient-to-r", b.color)}
                style={{ width: `${widthPct}%` }}
                title={`${b.label} (${b.from}–${b.to})`}
              />
            );
          })}
        </div>
        {/* Marker */}
        <div
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2"
          style={{ left: `${markerPct}%` }}
        >
          <div
            className={clsx(
              "w-4 h-4 rounded-full ring-2 ring-neutral-950 shadow-lg",
              bmi.category === "underweight" && "bg-sky-300",
              bmi.category === "normal" && "bg-emerald-300",
              bmi.category === "overweight" && "bg-amber-300",
              bmi.category === "obese" && "bg-rose-300",
            )}
          />
        </div>
        {/* Tick labels under the scale */}
        <div className="relative mt-2 h-4 text-[10px] text-neutral-500">
          {[18.5, 25, 30].map((tick) => (
            <span
              key={tick}
              className="absolute -translate-x-1/2 tabular-nums"
              style={{ left: `${pct(tick)}%` }}
            >
              {tick}
            </span>
          ))}
        </div>
      </div>

      {!compact && (
        <div className="grid sm:grid-cols-2 gap-3 text-sm">
          <Stat
            label="Healthy range"
            value={`${formatWeight(healthy.minKg, unitsPref)} – ${formatWeight(healthy.maxKg, unitsPref)}`}
            sub={`for your height (BMI 18.5 – 24.9)`}
          />
          <Stat
            label="vs healthy range"
            value={
              <span
                className={
                  weightKg < healthy.minKg
                    ? "text-sky-300"
                    : weightKg > healthy.maxKg
                      ? "text-rose-300"
                      : "text-emerald-300"
                }
              >
                {weightKg < healthy.minKg
                  ? `${formatWeight(Math.abs(toMinDelta), unitsPref)} under`
                  : weightKg > healthy.maxKg
                    ? `${formatWeight(toMaxDelta, unitsPref)} over`
                    : `in range`}
              </span>
            }
            sub={inRangeMsg}
          />
          {goalDelta != null && (
            <Stat
              label="vs your goal"
              value={
                <span
                  className={
                    Math.abs(goalDelta) < 0.05
                      ? "text-emerald-300"
                      : goalDelta > 0
                        ? "text-rose-300"
                        : "text-sky-300"
                  }
                >
                  {Math.abs(goalDelta) < 0.05
                    ? "at goal"
                    : goalDelta > 0
                      ? `${formatWeight(goalDelta, unitsPref)} above`
                      : `${formatWeight(-goalDelta, unitsPref)} below`}
                </span>
              }
              sub={`goal: ${formatWeight(goalWeightKg!, unitsPref)}`}
            />
          )}
          <Stat
            label="Unit"
            value={`BMI is unit-agnostic (kg / m²)`}
            sub={`Displayed weights in ${weightUnitLabel(unitsPref)}.`}
          />
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-white/5 bg-white/[0.02] px-3.5 py-3">
      <div className="text-[10px] uppercase tracking-wider text-neutral-500">{label}</div>
      <div className="text-sm font-medium mt-1 tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-neutral-500 mt-0.5">{sub}</div>}
    </div>
  );
}
