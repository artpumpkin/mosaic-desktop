"use client";
import { useMemo, useState } from "react";
import {
  cmToFtIn,
  ftInToCm,
  kgToLb,
  lbToKg,
  heightUnitLabel,
  weightUnitLabel,
} from "@/lib/health/units";
import type { UnitsPreference } from "@/lib/health/units";
import { BmiVisualizer } from "@/components/health/BmiVisualizer";
import { RotateCcw } from "lucide-react";

/**
 * Manual "calculate someone else's BMI" tool. Local state in metric
 * (canonical); inputs reflect the user's preferred units.
 */
export function OtherBmiSection({ unitsPref }: { unitsPref: UnitsPreference }) {
  const [heightCm, setHeightCm] = useState<number | null>(null);
  const [weightKg, setWeightKg] = useState<number | null>(null);

  const heightDisplay = useMemo(() => {
    if (heightCm == null) return { cm: "", ft: "", in: "" };
    if (unitsPref === "imperial") {
      const { ft, in: inches } = cmToFtIn(heightCm);
      return { cm: "", ft: String(ft), in: inches.toFixed(1) };
    }
    return { cm: heightCm.toFixed(0), ft: "", in: "" };
  }, [heightCm, unitsPref]);

  const weightDisplay = useMemo(() => {
    if (weightKg == null) return "";
    return unitsPref === "imperial" ? kgToLb(weightKg).toFixed(1) : weightKg.toFixed(1);
  }, [weightKg, unitsPref]);

  const reset = () => {
    setHeightCm(null);
    setWeightKg(null);
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-4 items-end max-w-2xl">
        <div>
          <label className="text-xs text-neutral-400 block mb-1.5">
            Height ({heightUnitLabel(unitsPref)})
          </label>
          {unitsPref === "imperial" ? (
            <div className="grid grid-cols-2 gap-2">
              <input
                type="number"
                inputMode="numeric"
                step="1"
                min="0"
                placeholder="ft"
                value={heightDisplay.ft}
                onChange={(e) => {
                  const ft = Number(e.target.value) || 0;
                  const inch = Number(heightDisplay.in) || 0;
                  setHeightCm(ft || inch ? ftInToCm(ft, inch) : null);
                }}
                aria-label="Height feet"
              />
              <input
                type="number"
                inputMode="decimal"
                step="0.1"
                min="0"
                placeholder="in"
                value={heightDisplay.in}
                onChange={(e) => {
                  const ft = Number(heightDisplay.ft) || 0;
                  const inch = Number(e.target.value) || 0;
                  setHeightCm(ft || inch ? ftInToCm(ft, inch) : null);
                }}
                aria-label="Height inches"
              />
            </div>
          ) : (
            <input
              type="number"
              inputMode="decimal"
              step="0.5"
              min="0"
              placeholder="175"
              value={heightDisplay.cm}
              onChange={(e) => {
                const v = Number(e.target.value);
                setHeightCm(Number.isFinite(v) && v > 0 ? v : null);
              }}
              aria-label="Height cm"
            />
          )}
        </div>

        <div>
          <label className="text-xs text-neutral-400 block mb-1.5">
            Weight ({weightUnitLabel(unitsPref)})
          </label>
          <input
            type="number"
            inputMode="decimal"
            step="0.1"
            min="0"
            placeholder={unitsPref === "imperial" ? "165.0" : "75.0"}
            value={weightDisplay}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (!Number.isFinite(v) || v <= 0) {
                setWeightKg(null);
              } else {
                setWeightKg(unitsPref === "imperial" ? lbToKg(v) : v);
              }
            }}
            aria-label="Weight"
          />
        </div>

        <button type="button" onClick={reset} className="btn-ghost">
          <RotateCcw size={14} /> Reset
        </button>
      </div>

      <BmiVisualizer weightKg={weightKg} heightCm={heightCm} unitsPref={unitsPref} />
    </div>
  );
}
