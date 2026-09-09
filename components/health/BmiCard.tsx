"use client";
import { calcBmi } from "@/lib/health/math";
import clsx from "clsx";

const CATEGORY_STYLE = {
  underweight: "text-sky-300 bg-sky-500/10 border-sky-400/30",
  normal: "text-emerald-300 bg-emerald-500/10 border-emerald-400/30",
  overweight: "text-amber-300 bg-amber-500/10 border-amber-400/30",
  obese: "text-rose-300 bg-rose-500/10 border-rose-400/30",
} as const;

export function BmiCard({
  weightKg,
  heightCm,
}: {
  weightKg: number | null;
  heightCm: number | null;
}) {
  if (!weightKg || !heightCm) {
    return (
      <div className="text-sm text-neutral-500">
        Set your height in Profile and log a weight to see your BMI.
      </div>
    );
  }
  const { value, category } = calcBmi(weightKg, heightCm);
  return (
    <div className="flex items-baseline gap-3 flex-wrap">
      <span className="text-4xl font-semibold tabular-nums gradient-text">
        {value.toFixed(1)}
      </span>
      <span
        className={clsx(
          "px-2 py-0.5 rounded-md text-xs uppercase tracking-wider border",
          CATEGORY_STYLE[category],
        )}
      >
        {category}
      </span>
    </div>
  );
}
