"use client";
import { useActionState, useEffect, useState } from "react";
import { Plus, Save, Trash2, X } from "lucide-react";
import {
  createTurnover,
  updateTurnover,
  deleteTurnover,
} from "@/lib/actions/rentals";
import type {
  Booking,
  RentalSettings,
  Turnover,
} from "@/lib/rentals/types";
import { useToastResult } from "../useToastResult";

function bookingOption(b: Booking): string {
  return `${b.guestName} (${b.checkInDate} → ${b.checkOutDate})`;
}

function TurnoverFields({
  bookings,
  defaults,
  settings,
}: {
  bookings: Booking[];
  defaults?: Partial<Turnover>;
  settings: RentalSettings;
}) {
  const cleaner = defaults?.cleanerCostMad ?? settings.cleanerDefaultMad;
  const fuel = defaults?.fuelCostMad ?? settings.fuelDefaultMad;
  const sweets = defaults?.sweetsCostMad ?? settings.sweetsDefaultMad;
  // Coerce booking ids to a string at this single boundary so the <select>
  // is always uncontrolled-with-a-defined-defaultValue (no undefined/null/""
  // inconsistency that triggers controlled/uncontrolled warnings).
  const bookingOutValue =
    defaults?.bookingOutId != null ? String(defaults.bookingOutId) : "";
  const bookingInValue =
    defaults?.bookingInId != null ? String(defaults.bookingInId) : "";
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="min-w-0">
          <label className="text-xs text-neutral-400 block mb-1.5">Date</label>
          <input
            name="turnoverDate"
            type="date"
            required
            defaultValue={defaults?.turnoverDate ?? new Date().toISOString().slice(0, 10)}
            aria-label="Turnover date"
          />
        </div>
        <div className="min-w-0">
          <label className="text-xs text-neutral-400 block mb-1.5">
            Guest leaving
          </label>
          <select
            name="bookingOutId"
            defaultValue={bookingOutValue}
            aria-label="Booking out"
          >
            <option value="">—</option>
            {bookings.map((b) => (
              <option key={b.id} value={b.id}>
                {bookingOption(b)}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-0">
          <label className="text-xs text-neutral-400 block mb-1.5">
            Guest arriving
          </label>
          <select
            name="bookingInId"
            defaultValue={bookingInValue}
            aria-label="Booking in"
          >
            <option value="">—</option>
            {bookings.map((b) => (
              <option key={b.id} value={b.id}>
                {bookingOption(b)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <CostField label="Cleaner (MAD)" name="cleanerCostMad" defaultValue={cleaner} />
        <CostField label="Fuel (MAD)" name="fuelCostMad" defaultValue={fuel} />
        <CostField label="Sweets (MAD)" name="sweetsCostMad" defaultValue={sweets} />
        <CostField label="Other (MAD)" name="otherCostMad" defaultValue={defaults?.otherCostMad ?? 0} />
      </div>

      <div className="min-w-0">
        <label className="text-xs text-neutral-400 block mb-1.5">
          Other cost note
        </label>
        <input
          name="otherNote"
          defaultValue={defaults?.otherNote ?? ""}
          placeholder="Optional — what the 'other' covered"
          aria-label="Other note"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <CheckboxField
          name="cleaningDone"
          label="Cleaning done"
          defaultChecked={defaults?.cleaningDone}
        />
        <CheckboxField
          name="guestWelcomed"
          label="Guest welcomed"
          defaultChecked={defaults?.guestWelcomed}
        />
        <CheckboxField
          name="keysReturned"
          label="Keys returned"
          defaultChecked={defaults?.keysReturned}
        />
      </div>

      <div className="min-w-0">
        <label className="text-xs text-neutral-400 block mb-1.5">Note</label>
        <input
          name="note"
          defaultValue={defaults?.note ?? ""}
          placeholder="Optional"
          aria-label="Note"
        />
      </div>
    </div>
  );
}

function CostField({
  label,
  name,
  defaultValue,
}: {
  label: string;
  name: string;
  defaultValue: number;
}) {
  return (
    <div className="min-w-0">
      <label className="text-xs text-neutral-400 block mb-1.5">{label}</label>
      <input
        name={name}
        type="number"
        step="0.01"
        min="0"
        defaultValue={defaultValue}
        aria-label={label}
      />
    </div>
  );
}

function CheckboxField({
  name,
  label,
  defaultChecked,
}: {
  name: string;
  label: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className="flex items-center gap-2 rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2.5 cursor-pointer hover:bg-white/[0.04] transition-colors">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="accent-teal-400"
      />
      <span className="text-sm">{label}</span>
    </label>
  );
}

export function TurnoverCreateForm({
  bookings,
  settings,
  defaultDate,
  defaultBookingOutId,
  defaultBookingInId,
  onDone,
}: {
  bookings: Booking[];
  settings: RentalSettings;
  defaultDate?: string;
  defaultBookingOutId?: number;
  defaultBookingInId?: number;
  onDone?: () => void;
}) {
  const [state, formAction, pending] = useActionState(createTurnover, null);
  useToastResult(state);
  useEffect(() => {
    if (state?.ok && onDone) onDone();
  }, [state, onDone]);
  return (
    <form action={formAction} className="space-y-4">
      <TurnoverFields
        bookings={bookings}
        settings={settings}
        defaults={{
          turnoverDate: defaultDate,
          bookingOutId: defaultBookingOutId ?? null,
          bookingInId: defaultBookingInId ?? null,
        }}
      />
      <div className="flex justify-end">
        <button type="submit" disabled={pending} className="btn-primary">
          <Plus size={15} /> {pending ? "Saving…" : "Log turnover"}
        </button>
      </div>
    </form>
  );
}

export function TurnoverEditForm({
  turnover,
  bookings,
  settings,
  onCancel,
  onDone,
}: {
  turnover: Turnover;
  bookings: Booking[];
  settings: RentalSettings;
  onCancel?: () => void;
  onDone?: () => void;
}) {
  const [state, formAction, pending] = useActionState(updateTurnover, null);
  useToastResult(state);
  useEffect(() => {
    if (state?.ok && onDone) onDone();
  }, [state, onDone]);
  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="id" value={turnover.id} />
      <TurnoverFields bookings={bookings} settings={settings} defaults={turnover} />
      <div className="flex gap-2 justify-end">
        {onCancel && (
          <button type="button" onClick={onCancel} className="btn-ghost">
            <X size={13} /> Cancel
          </button>
        )}
        <button type="submit" disabled={pending} className="btn-primary">
          <Save size={13} /> {pending ? "Saving…" : "Save changes"}
        </button>
      </div>
    </form>
  );
}

export function TurnoverDeleteButton({ id }: { id: number }) {
  const [state, formAction, pending] = useActionState(deleteTurnover, null);
  useToastResult(state);
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="btn-danger"
        aria-label="Delete turnover"
      >
        <Trash2 size={13} /> Delete
      </button>
    );
  }
  return (
    <form action={formAction} className="flex items-center gap-1.5">
      <input type="hidden" name="id" value={id} />
      <span className="text-[11px] text-rose-300">Sure?</span>
      <button type="submit" disabled={pending} className="btn-danger">
        Yes
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="btn-ghost"
      >
        No
      </button>
    </form>
  );
}
