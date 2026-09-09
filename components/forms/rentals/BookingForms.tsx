"use client";
import { useActionState, useEffect, useState } from "react";
import { Plus, Save, Trash2, X } from "lucide-react";
import {
  createBooking,
  updateBooking,
  deleteBooking,
} from "@/lib/actions/rentals";
import {
  type Booking,
  type BookingPlatform,
  type BookingStatus,
  PLATFORM_LABEL,
  STATUS_LABEL,
} from "@/lib/rentals/types";
import { useToastResult } from "../useToastResult";

const platforms: BookingPlatform[] = ["airbnb", "booking", "direct", "other"];
const statuses: BookingStatus[] = ["confirmed", "pending", "completed", "cancelled"];

function BookingFields({
  defaults,
}: {
  defaults?: Partial<Booking> & { checkInDate?: string };
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      <div className="min-w-0">
        <label className="text-xs text-neutral-400 block mb-1.5">Guest name</label>
        <input
          name="guestName"
          required
          defaultValue={defaults?.guestName ?? ""}
          aria-label="Guest name"
        />
      </div>
      <div className="min-w-0">
        <label className="text-xs text-neutral-400 block mb-1.5">Check-in</label>
        <input
          name="checkInDate"
          type="date"
          required
          defaultValue={defaults?.checkInDate ?? ""}
          aria-label="Check-in date"
        />
      </div>
      <div className="min-w-0">
        <label className="text-xs text-neutral-400 block mb-1.5">Check-out</label>
        <input
          name="checkOutDate"
          type="date"
          required
          defaultValue={defaults?.checkOutDate ?? ""}
          aria-label="Check-out date"
        />
      </div>
      <div className="min-w-0">
        <label className="text-xs text-neutral-400 block mb-1.5">
          Total paid (MAD)
        </label>
        <input
          name="amountPaidMad"
          type="number"
          step="0.01"
          min="0"
          required
          defaultValue={defaults?.amountPaidMad ?? ""}
          aria-label="Amount paid"
        />
      </div>
      <div className="min-w-0">
        <label className="text-xs text-neutral-400 block mb-1.5">Platform</label>
        <select
          name="platform"
          defaultValue={defaults?.platform ?? "airbnb"}
          aria-label="Platform"
        >
          {platforms.map((p) => (
            <option key={p} value={p}>
              {PLATFORM_LABEL[p]}
            </option>
          ))}
        </select>
      </div>
      <div className="min-w-0">
        <label className="text-xs text-neutral-400 block mb-1.5">Status</label>
        <select
          name="status"
          defaultValue={defaults?.status ?? "confirmed"}
          aria-label="Status"
        >
          {statuses.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </div>
      <div className="min-w-0 sm:col-span-2 lg:col-span-3">
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

export function BookingCreateForm({
  defaultCheckIn,
  onDone,
}: {
  defaultCheckIn?: string;
  onDone?: () => void;
}) {
  const [state, formAction, pending] = useActionState(createBooking, null);
  useToastResult(state);
  useEffect(() => {
    if (state?.ok && onDone) onDone();
  }, [state, onDone]);
  return (
    <form action={formAction} className="space-y-4">
      <BookingFields defaults={{ checkInDate: defaultCheckIn }} />
      <div className="flex justify-end">
        <button type="submit" disabled={pending} className="btn-primary">
          <Plus size={15} /> {pending ? "Saving…" : "Save booking"}
        </button>
      </div>
    </form>
  );
}

export function BookingEditForm({
  booking,
  onCancel,
  onDone,
}: {
  booking: Booking;
  onCancel?: () => void;
  onDone?: () => void;
}) {
  const [state, formAction, pending] = useActionState(updateBooking, null);
  useToastResult(state);
  useEffect(() => {
    if (state?.ok && onDone) onDone();
  }, [state, onDone]);
  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="id" value={booking.id} />
      <BookingFields defaults={booking} />
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

export function BookingDeleteButton({ id, label }: { id: number; label?: string }) {
  const [state, formAction, pending] = useActionState(deleteBooking, null);
  useToastResult(state);
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="btn-danger"
        aria-label={`Delete booking${label ? " for " + label : ""}`}
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
