"use client";
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
import GlassCard from "@/components/GlassCard";
import type { Booking } from "@/lib/rentals/types";
import {
  BookingCreateForm,
  BookingEditForm,
} from "@/components/forms/rentals/BookingForms";
import clsx from "clsx";

const STATUS_BAND: Record<Booking["status"], string> = {
  confirmed: "bg-emerald-500/35 text-emerald-50 border-emerald-400/40",
  pending: "bg-amber-500/35 text-amber-50 border-amber-400/40",
  completed: "bg-white/10 text-neutral-200 border-white/15",
  cancelled: "bg-rose-500/20 text-rose-200/70 border-rose-400/30 line-through",
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const MS_PER_DAY = 86_400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

function startOfMonthGrid(year: number, month: number): Date {
  // Grid starts on Monday containing the 1st of the month.
  const first = new Date(Date.UTC(year, month, 1));
  // 0=Sun…6=Sat → shift so Monday=0
  const dow = (first.getUTCDay() + 6) % 7;
  return new Date(first.getTime() - dow * MS_PER_DAY);
}

type DayCell = {
  date: Date;
  iso: string;
  inMonth: boolean;
  bookings: Booking[];
  bandLefts: Map<number, boolean>;
  bandRights: Map<number, boolean>;
};

function buildGrid(year: number, month: number, bookings: Booking[]): DayCell[] {
  const gridStart = startOfMonthGrid(year, month);
  const cells: DayCell[] = [];
  for (let i = 0; i < 42; i++) {
    const date = new Date(gridStart.getTime() + i * MS_PER_DAY);
    const iso = isoDay(date);
    const inMonth = date.getUTCMonth() === month;
    const dayMs = date.getTime();
    const next = dayMs + MS_PER_DAY;
    const dayBookings = bookings.filter((b) => {
      const inMs = new Date(b.checkInDate + "T00:00:00Z").getTime();
      const outMs = new Date(b.checkOutDate + "T00:00:00Z").getTime();
      // A night belongs to date `d` if d in [checkIn, checkOut)
      return dayMs >= inMs && dayMs < outMs;
    });
    const bandLefts = new Map<number, boolean>();
    const bandRights = new Map<number, boolean>();
    for (const b of dayBookings) {
      const inMs = new Date(b.checkInDate + "T00:00:00Z").getTime();
      const outMs = new Date(b.checkOutDate + "T00:00:00Z").getTime();
      bandLefts.set(b.id, dayMs === inMs);
      bandRights.set(b.id, next === outMs);
    }
    cells.push({ date, iso, inMonth, bookings: dayBookings, bandLefts, bandRights });
  }
  return cells;
}

export function BookingsCalendar({ bookings }: { bookings: Booking[] }) {
  // Recompute per render — memoizing with empty deps froze "today" at first
  // mount, drifting the Today highlight/button after a midnight day boundary.
  const today = new Date();
  const [cursor, setCursor] = useState(() => ({
    year: today.getFullYear(),
    month: today.getMonth(),
  }));
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [editingBooking, setEditingBooking] = useState<Booking | null>(null);

  const grid = useMemo(
    () => buildGrid(cursor.year, cursor.month, bookings),
    [cursor, bookings],
  );

  const monthHasBookings = useMemo(
    () => grid.some((cell) => cell.inMonth && cell.bookings.length > 0),
    [grid],
  );

  const monthLabel = new Date(Date.UTC(cursor.year, cursor.month, 1)).toLocaleDateString(
    undefined,
    { month: "long", year: "numeric" },
  );

  function shift(delta: number) {
    setCursor((c) => {
      const d = new Date(Date.UTC(c.year, c.month + delta, 1));
      return { year: d.getUTCFullYear(), month: d.getUTCMonth() };
    });
    setSelectedDate(null);
    setEditingBooking(null);
  }

  return (
    <GlassCard padding={false}>
      <div className="px-4 sm:px-5 py-3.5 border-b border-white/5 flex items-center justify-between gap-3">
        <h2 className="font-medium">{monthLabel}</h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => shift(-1)}
            className="btn-ghost !px-2"
            aria-label="Previous month"
          >
            <ChevronLeft size={14} />
          </button>
          <button
            type="button"
            onClick={() =>
              setCursor({ year: today.getFullYear(), month: today.getMonth() })
            }
            className="btn-ghost text-[11px]"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => shift(1)}
            className="btn-ghost !px-2"
            aria-label="Next month"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </div>

      <div className="px-2 sm:px-3 pt-2">
        <div className="grid grid-cols-7 text-[10px] uppercase tracking-wider text-neutral-500 px-1.5 pb-1">
          {WEEKDAYS.map((d) => (
            <div key={d} className="py-1">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1 pb-3">
          {grid.map((cell) => {
            const isToday = cell.iso === isoDay(today);
            const hasBookings = cell.bookings.length > 0;
            return (
              <button
                key={cell.iso}
                type="button"
                onClick={() => {
                  setSelectedDate(cell.iso);
                  setEditingBooking(null);
                }}
                className={clsx(
                  "relative min-h-[64px] sm:min-h-[88px] lg:min-h-[104px] rounded-md p-1.5 text-left transition-colors border",
                  cell.inMonth
                    ? "bg-white/[0.02] border-white/5 hover:bg-white/[0.05]"
                    : "bg-transparent border-transparent text-neutral-600",
                  isToday && "ring-1 ring-teal-400/60",
                )}
              >
                <div className="flex items-center justify-between">
                  <span className={clsx("text-[11px] tabular-nums", isToday && "text-teal-200 font-medium")}>
                    {cell.date.getUTCDate()}
                  </span>
                  {hasBookings && cell.bookings.length > 1 && (
                    <span className="text-[9px] text-neutral-500">
                      {cell.bookings.length}
                    </span>
                  )}
                </div>
                <div className="mt-1 space-y-0.5">
                  {cell.bookings.slice(0, 2).map((b) => (
                    <div
                      key={b.id}
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingBooking(b);
                        setSelectedDate(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.stopPropagation();
                          setEditingBooking(b);
                          setSelectedDate(null);
                        }
                      }}
                      className={clsx(
                        "text-[11px] leading-tight truncate px-1.5 py-0.5 border",
                        STATUS_BAND[b.status],
                        cell.bandLefts.get(b.id) ? "rounded-l-md" : "",
                        cell.bandRights.get(b.id) ? "rounded-r-md" : "",
                      )}
                      title={`${b.guestName} · ${b.checkInDate} → ${b.checkOutDate}`}
                    >
                      {cell.bandLefts.get(b.id) ? b.guestName : "·"}
                    </div>
                  ))}
                </div>
              </button>
            );
          })}
        </div>
        {!monthHasBookings && (
          <p className="px-1.5 pb-3 -mt-1 text-[11px] text-neutral-500">
            No bookings this month — click a day to add one.
          </p>
        )}
      </div>

      {(selectedDate || editingBooking) && (
        <div className="border-t border-white/5 p-4 sm:p-5 bg-white/[0.015]">
          <div className="mx-auto w-full max-w-3xl">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-medium flex items-center gap-2 text-sm">
              {editingBooking ? (
                <>Edit booking</>
              ) : (
                <>
                  <Plus size={14} className="text-teal-300" /> New booking for{" "}
                  <span className="font-mono text-teal-200">{selectedDate}</span>
                </>
              )}
            </h3>
            <button
              type="button"
              onClick={() => {
                setSelectedDate(null);
                setEditingBooking(null);
              }}
              className="btn-ghost"
            >
              <X size={13} />
            </button>
          </div>
          {editingBooking ? (
            <BookingEditForm
              booking={editingBooking}
              onCancel={() => setEditingBooking(null)}
              onDone={() => setEditingBooking(null)}
            />
          ) : (
            <BookingCreateForm
              defaultCheckIn={selectedDate ?? undefined}
              onDone={() => setSelectedDate(null)}
            />
          )}
          </div>
        </div>
      )}
    </GlassCard>
  );
}
