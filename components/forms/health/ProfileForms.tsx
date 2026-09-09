"use client";
import { useActionState, useMemo, useState } from "react";
import { Save } from "lucide-react";
import { updateHealthProfile } from "@/lib/actions/healthProfile";
import type { HealthProfile } from "@/lib/settings";
import type { UnitsPreference } from "@/lib/health/units";
import {
  cmToFtIn,
  ftInToCm,
  kgToLb,
  lbToKg,
  weightUnitLabel,
} from "@/lib/health/units";
import {
  ACTIVITY_LABEL,
  calcAgeYears,
  calcBmr,
  calcTdee,
  type ActivityLevel,
} from "@/lib/health/math";
import { useToastResult } from "../useToastResult";

const ACTIVITY_OPTIONS: ActivityLevel[] = [
  "sedentary",
  "light",
  "moderate",
  "very",
  "extra",
];

export function HealthProfileForm({
  initial,
  unitsPref,
  latestWeightKg,
}: {
  initial: HealthProfile;
  unitsPref: UnitsPreference;
  latestWeightKg: number | null;
}) {
  const [state, formAction, pending] = useActionState(updateHealthProfile, null);
  useToastResult(state);

  // Canonical metric values, kept at full precision (no re-rounding). These are
  // the source of truth posted via the hidden inputs; the display fields only
  // FORMAT them, they never round the canonical value back into itself.
  const initialHeightCm = initial.heightCm != null ? String(initial.heightCm) : "";
  const initialGoalKg =
    initial.goalWeightKg != null ? String(initial.goalWeightKg) : "";
  const [heightCm, setHeightCm] = useState<string>(initialHeightCm);
  const [goalKg, setGoalKg] = useState<string>(initialGoalKg);

  // Resync to fresh props after a successful save / when the loaded profile
  // changes, so the form reflects the persisted values instead of stale input.
  // Render-time "adjust state when a prop changes" idiom (no effect needed).
  const [syncedFrom, setSyncedFrom] = useState({
    h: initialHeightCm,
    g: initialGoalKg,
  });
  if (syncedFrom.h !== initialHeightCm || syncedFrom.g !== initialGoalKg) {
    setSyncedFrom({ h: initialHeightCm, g: initialGoalKg });
    setHeightCm(initialHeightCm);
    setGoalKg(initialGoalKg);
  }

  // Display values driven by `unitsPref`. Imperial display keeps extra
  // precision (inches at 2dp) so it doesn't truncate the canonical cm.
  const heightDisplay = useMemo(() => {
    const n = Number(heightCm);
    if (!Number.isFinite(n) || n === 0) return { cm: "", ft: "", in: "" };
    if (unitsPref === "imperial") {
      const { ft, in: inches } = cmToFtIn(n);
      return { cm: "", ft: String(ft), in: inches.toFixed(2) };
    }
    return { cm: String(Math.round(n)), ft: "", in: "" };
  }, [heightCm, unitsPref]);

  const goalDisplay = useMemo(() => {
    const n = Number(goalKg);
    if (!Number.isFinite(n) || n === 0) return "";
    return unitsPref === "imperial" ? kgToLb(n).toFixed(1) : n.toFixed(1);
  }, [goalKg, unitsPref]);

  const updateHeightCm = (cm: string) => {
    setHeightCm(cm.trim());
  };
  const updateHeightFromImperial = (ft: string, inches: string) => {
    const ftN = Number(ft) || 0;
    const inN = Number(inches) || 0;
    if (ftN === 0 && inN === 0) {
      setHeightCm("");
      return;
    }
    // Store full-precision cm — don't pre-round, that's what drifts the value.
    setHeightCm(String(ftInToCm(ftN, inN)));
  };

  const updateGoalFromDisplay = (v: string) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n === 0) {
      setGoalKg("");
      return;
    }
    // Full-precision kg; display formats to 1dp but the source stays exact.
    setGoalKg(String(unitsPref === "imperial" ? lbToKg(n) : n));
  };

  // Signature of the props-derived defaultValue fields. Bumping the key on a
  // wrapper forces those uncontrolled inputs/selects to rebind to fresh props
  // after a save (defaultValue alone never re-applies on its own).
  const fieldsKey = [
    initial.gender,
    initial.dateOfBirth ?? "",
    initial.activityLevel,
    initial.dailyCalorieTarget ?? "",
    initialHeightCm,
    initialGoalKg,
  ].join("|");

  // Live BMR/TDEE preview.
  const preview = useMemo(() => {
    const w =
      latestWeightKg != null && latestWeightKg > 0
        ? latestWeightKg
        : Number(goalKg) || 0;
    const h = Number(heightCm) || 0;
    const age = calcAgeYears(initial.dateOfBirth);
    if (!w || !h || !age) return null;
    const bmr = calcBmr({
      gender: initial.gender,
      weightKg: w,
      heightCm: h,
      ageYears: age,
    });
    const tdee = calcTdee(bmr, initial.activityLevel);
    return { bmr, tdee };
  }, [heightCm, goalKg, latestWeightKg, initial.gender, initial.activityLevel, initial.dateOfBirth]);

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="heightCm" value={heightCm} />
      <input type="hidden" name="goalWeightKg" value={goalKg} />

      <div key={fieldsKey} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="min-w-0">
          <label className="text-xs text-neutral-400 block mb-1.5">Height</label>
          {unitsPref === "imperial" ? (
            <div className="grid grid-cols-2 gap-2">
              <input
                type="number"
                inputMode="numeric"
                step="1"
                min="0"
                placeholder="ft"
                defaultValue={heightDisplay.ft}
                onChange={(e) => updateHeightFromImperial(e.target.value, heightDisplay.in)}
                aria-label="Height feet"
              />
              <input
                type="number"
                inputMode="decimal"
                step="0.1"
                min="0"
                placeholder="in"
                defaultValue={heightDisplay.in}
                onChange={(e) => updateHeightFromImperial(heightDisplay.ft, e.target.value)}
                aria-label="Height inches"
              />
            </div>
          ) : (
            <input
              type="number"
              inputMode="decimal"
              step="0.5"
              min="0"
              placeholder="cm"
              defaultValue={heightDisplay.cm}
              onChange={(e) => updateHeightCm(e.target.value)}
              aria-label="Height cm"
            />
          )}
        </div>

        <div className="min-w-0">
          <label className="text-xs text-neutral-400 block mb-1.5">
            Goal weight ({weightUnitLabel(unitsPref)})
          </label>
          <input
            type="number"
            inputMode="decimal"
            step="0.1"
            min="0"
            defaultValue={goalDisplay}
            onChange={(e) => updateGoalFromDisplay(e.target.value)}
            placeholder={unitsPref === "imperial" ? "165.0" : "75.0"}
            aria-label="Goal weight"
          />
        </div>

        <div className="min-w-0">
          <label className="text-xs text-neutral-400 block mb-1.5">Gender</label>
          <select name="gender" defaultValue={initial.gender} aria-label="Gender">
            <option value="male">Male</option>
            <option value="female">Female</option>
          </select>
        </div>

        <div className="min-w-0">
          <label className="text-xs text-neutral-400 block mb-1.5">Date of birth</label>
          <input
            type="date"
            name="dateOfBirth"
            defaultValue={initial.dateOfBirth ?? ""}
            aria-label="Date of birth"
          />
        </div>

        <div className="sm:col-span-2 min-w-0">
          <label className="text-xs text-neutral-400 block mb-1.5">Activity level</label>
          <select
            name="activityLevel"
            defaultValue={initial.activityLevel}
            aria-label="Activity level"
          >
            {ACTIVITY_OPTIONS.map((a) => (
              <option key={a} value={a}>
                {ACTIVITY_LABEL[a]}
              </option>
            ))}
          </select>
        </div>

        <div className="sm:col-span-2 min-w-0">
          <label className="text-xs text-neutral-400 block mb-1.5">
            Daily calorie target (optional — leave blank to auto-compute as TDEE − 500)
          </label>
          <input
            type="number"
            name="dailyCalorieTarget"
            inputMode="numeric"
            step="10"
            min="0"
            defaultValue={initial.dailyCalorieTarget ?? ""}
            placeholder="e.g. 2000"
            aria-label="Daily calorie target"
          />
        </div>
      </div>

      {preview && (
        <div className="text-xs text-neutral-400 flex flex-wrap gap-x-5 gap-y-1">
          <span>
            BMR: <span className="text-neutral-200 tabular-nums">{Math.round(preview.bmr)}</span> kcal
          </span>
          <span>
            TDEE: <span className="text-neutral-200 tabular-nums">{Math.round(preview.tdee)}</span> kcal
          </span>
          <span className="text-emerald-300">
            Suggested intake (TDEE − 500):{" "}
            <span className="tabular-nums">{Math.round(preview.tdee - 500)}</span> kcal
          </span>
        </div>
      )}

      <button type="submit" disabled={pending} className="btn-primary">
        <Save size={15} /> {pending ? "Saving…" : "Save profile"}
      </button>
    </form>
  );
}
