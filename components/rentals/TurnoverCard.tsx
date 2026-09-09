"use client";
import { useState } from "react";
import { ArrowRight, Check, Pencil } from "lucide-react";
import type { Booking, RentalSettings, Turnover } from "@/lib/rentals/types";
import { fmtMad } from "@/lib/format";
import Sensitive from "@/components/Sensitive";
import {
  TurnoverDeleteButton,
  TurnoverEditForm,
} from "@/components/forms/rentals/TurnoverForms";
import clsx from "clsx";

export function TurnoverCard({
  turnover,
  bookings,
  settings,
}: {
  turnover: Turnover;
  bookings: Booking[];
  settings: RentalSettings;
}) {
  const [editing, setEditing] = useState(false);

  const bookingOut = bookings.find((b) => b.id === turnover.bookingOutId) ?? null;
  const bookingIn = bookings.find((b) => b.id === turnover.bookingInId) ?? null;
  const total =
    turnover.cleanerCostMad +
    turnover.fuelCostMad +
    turnover.sweetsCostMad +
    turnover.otherCostMad;
  const tasksDone =
    Number(turnover.cleaningDone) + Number(turnover.guestWelcomed) + Number(turnover.keysReturned);
  const allDone = tasksDone === 3;

  if (editing) {
    return (
      <div className="rounded-2xl border border-white/5 bg-white/[0.025] p-4 sm:p-5">
        <TurnoverEditForm
          turnover={turnover}
          bookings={bookings}
          settings={settings}
          onCancel={() => setEditing(false)}
          onDone={() => setEditing(false)}
        />
      </div>
    );
  }

  return (
    <div
      className={clsx(
        "rounded-2xl border p-4 sm:p-5 transition-colors",
        allDone
          ? "border-emerald-400/20 bg-emerald-500/[0.04]"
          : "border-white/5 bg-white/[0.02]",
      )}
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-neutral-500">
            Turnover
          </div>
          <div className="mt-0.5 font-medium tabular-nums">{turnover.turnoverDate}</div>
          <div className="mt-1 text-sm text-neutral-300 flex items-center gap-2 flex-wrap">
            <span className="truncate">
              {bookingOut ? bookingOut.guestName : "—"}
            </span>
            <ArrowRight size={13} className="text-neutral-500 shrink-0" />
            <span className="truncate">
              {bookingIn ? bookingIn.guestName : "—"}
            </span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wider text-neutral-500">
            Total cost
          </div>
          <div className="text-xl font-semibold tabular-nums"><Sensitive>{fmtMad(total)}</Sensitive></div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
        <Cost label="Cleaner" value={turnover.cleanerCostMad} />
        <Cost label="Fuel" value={turnover.fuelCostMad} />
        <Cost label="Sweets" value={turnover.sweetsCostMad} />
        <Cost label="Other" value={turnover.otherCostMad} note={turnover.otherNote} />
      </div>

      <div className="mt-3 flex gap-1.5 flex-wrap">
        <TaskPill done={turnover.cleaningDone} label="Cleaning" />
        <TaskPill done={turnover.guestWelcomed} label="Welcomed" />
        <TaskPill done={turnover.keysReturned} label="Keys" />
      </div>

      {turnover.note && (
        <p className="mt-3 text-[12px] text-neutral-400 italic">“{turnover.note}”</p>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="btn-ghost"
        >
          <Pencil size={13} /> Edit
        </button>
        <TurnoverDeleteButton id={turnover.id} />
      </div>
    </div>
  );
}

function Cost({
  label,
  value,
  note,
}: {
  label: string;
  value: number;
  note?: string | null;
}) {
  return (
    <div className="rounded-lg bg-white/[0.02] border border-white/5 px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-neutral-500">
        {label}
      </div>
      <div className="font-medium tabular-nums"><Sensitive>{fmtMad(value)}</Sensitive></div>
      {note && <div className="text-[10px] text-neutral-500 truncate">{note}</div>}
    </div>
  );
}

function TaskPill({ done, label }: { done: boolean; label: string }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] uppercase tracking-wider",
        done
          ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-300"
          : "border-white/10 bg-white/[0.02] text-neutral-500",
      )}
    >
      {done && <Check size={10} />}
      {label}
    </span>
  );
}
