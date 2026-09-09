"use client";
import { useState } from "react";
import GlassCard from "@/components/GlassCard";
import EmptyState from "@/components/EmptyState";
import { CalendarX, Pencil } from "lucide-react";
import type { Booking } from "@/lib/rentals/types";
import { PLATFORM_LABEL, STATUS_LABEL } from "@/lib/rentals/types";
import { fmtMad } from "@/lib/format";
import Sensitive from "@/components/Sensitive";
import { BookingDeleteButton, BookingEditForm } from "@/components/forms/rentals/BookingForms";
import clsx from "clsx";

const STATUS_TONE: Record<Booking["status"], string> = {
  confirmed: "border-emerald-400/30 text-emerald-300 bg-emerald-500/10",
  pending: "border-amber-400/30 text-amber-300 bg-amber-500/10",
  completed: "border-neutral-400/20 text-neutral-300 bg-white/[0.04]",
  cancelled: "border-rose-400/30 text-rose-300 bg-rose-500/10",
};

export function BookingsTable({ bookings }: { bookings: Booking[] }) {
  if (bookings.length === 0) {
    return (
      <EmptyState
        icon={CalendarX}
        title="No bookings yet"
        hint="Click a day on the calendar above to add one."
      />
    );
  }
  return (
    <GlassCard padding={false}>
      <div className="px-4 sm:px-5 py-3.5 border-b border-white/5 flex items-center justify-between">
        <h2 className="font-medium">Bookings</h2>
        <span className="text-[11px] uppercase tracking-wider text-neutral-500">
          {bookings.length} total
        </span>
      </div>
      <div className="max-h-[28rem] overflow-y-auto">
        <ul className="divide-y divide-white/[0.04]">
          {bookings.map((b) => (
            <BookingRow key={b.id} booking={b} />
          ))}
        </ul>
      </div>
    </GlassCard>
  );
}

function BookingRow({ booking }: { booking: Booking }) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <li className="px-4 sm:px-5 py-4 bg-white/[0.02]">
        <BookingEditForm
          booking={booking}
          onCancel={() => setEditing(false)}
          onDone={() => setEditing(false)}
        />
      </li>
    );
  }
  return (
    <li className="px-4 sm:px-5 py-3 flex items-center gap-3 hover:bg-white/[0.015] transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm truncate">{booking.guestName}</span>
          <span
            className={clsx(
              "text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border",
              STATUS_TONE[booking.status],
            )}
          >
            {STATUS_LABEL[booking.status]}
          </span>
          <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-white/10 text-neutral-400 bg-white/[0.02]">
            {PLATFORM_LABEL[booking.platform]}
          </span>
        </div>
        <div className="text-xs text-neutral-500 mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5">
          <span>{booking.checkInDate} → {booking.checkOutDate}</span>
          <span>· {booking.nights} night{booking.nights === 1 ? "" : "s"}</span>
          <span>· <Sensitive>{fmtMad(booking.amountPaidMad)}</Sensitive></span>
          {booking.note && <span className="truncate">· {booking.note}</span>}
        </div>
      </div>
      <div className="flex gap-2 shrink-0">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="btn-ghost"
          aria-label="Edit booking"
        >
          <Pencil size={13} /> Edit
        </button>
        <BookingDeleteButton id={booking.id} label={booking.guestName} />
      </div>
    </li>
  );
}
