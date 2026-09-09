"use client";
import { useActionState, useMemo, useState } from "react";
import { Save } from "lucide-react";
import { updateRentalSettings } from "@/lib/actions/rentals";
import type { RentalSettings } from "@/lib/rentals/types";
import { fuelCostPerTrip } from "@/lib/rentals/math";
import { useToastResult } from "../useToastResult";

export function RentalSettingsForm({ initial }: { initial: RentalSettings }) {
  const [state, formAction, pending] = useActionState(updateRentalSettings, null);
  useToastResult(state);

  // Live preview of the computed fuel cost per turnover trip
  const [distance, setDistance] = useState(initial.distanceKmRoundTrip);
  const [lPer100, setLPer100] = useState(initial.consumptionLper100km);
  const [pricePerL, setPricePerL] = useState(initial.fuelPricePerLiterMad);
  const computedFuel = useMemo(
    () => fuelCostPerTrip(distance, lPer100, pricePerL),
    [distance, lPer100, pricePerL],
  );

  return (
    <form action={formAction} className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field
          label="Nightly rate (MAD)"
          name="nightlyRateMad"
          step="1"
          defaultValue={initial.nightlyRateMad}
          hint="Your published default per night."
        />
        <Field
          label="Cleaner per turnover (MAD)"
          name="cleanerDefaultMad"
          step="1"
          defaultValue={initial.cleanerDefaultMad}
          hint="What you usually pay the cleaner."
        />
        <Field
          label="Sweets / welcome gift (MAD)"
          name="sweetsDefaultMad"
          step="1"
          defaultValue={initial.sweetsDefaultMad}
          hint="Per guest, optional."
        />
        <Field
          label="Fuel per turnover (MAD)"
          name="fuelDefaultMad"
          step="0.5"
          defaultValue={initial.fuelDefaultMad}
          hint={`Computed estimate: ${computedFuel.toFixed(2)} MAD`}
        />
      </div>

      <div>
        <h3 className="text-xs uppercase tracking-[0.2em] text-neutral-500 mb-2">
          Fuel calculator inputs
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field
            label="Round trip distance (km)"
            name="distanceKmRoundTrip"
            step="0.1"
            defaultValue={initial.distanceKmRoundTrip}
            disabled={pending}
            onChange={(v) => setDistance(v)}
          />
          <Field
            label="Consumption (L / 100km)"
            name="consumptionLper100km"
            step="0.1"
            defaultValue={initial.consumptionLper100km}
            disabled={pending}
            onChange={(v) => setLPer100(v)}
          />
          <Field
            label="Fuel price (MAD / L)"
            name="fuelPricePerLiterMad"
            step="0.01"
            defaultValue={initial.fuelPricePerLiterMad}
            disabled={pending}
            onChange={(v) => setPricePerL(v)}
          />
        </div>
        <p className="text-[11px] text-neutral-500 mt-2">
          Using these inputs, one round trip costs roughly{" "}
          <strong className="text-neutral-300">{computedFuel.toFixed(2)} MAD</strong>.
          Use this to keep the &ldquo;fuel per turnover&rdquo; default honest.
        </p>
      </div>

      <div className="flex justify-end">
        <button type="submit" disabled={pending} className="btn-primary">
          <Save size={14} /> {pending ? "Saving…" : "Save defaults"}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  name,
  defaultValue,
  step = "1",
  hint,
  onChange,
  disabled,
}: {
  label: string;
  name: string;
  defaultValue: number;
  step?: string;
  hint?: string;
  onChange?: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="min-w-0">
      <label className="text-xs text-neutral-400 block mb-1.5">{label}</label>
      <input
        name={name}
        type="number"
        step={step}
        min="0"
        defaultValue={defaultValue}
        disabled={disabled}
        aria-label={label}
        // Gate the live recompute behind the submit pending flag so an
        // in-flight save can't race a flurry of onChange recomputes.
        onChange={
          onChange && !disabled
            ? (e) => onChange(Number(e.target.value) || 0)
            : undefined
        }
      />
      {hint && <p className="text-[11px] text-neutral-500 mt-1">{hint}</p>}
    </div>
  );
}
