"use client";
import { useState } from "react";
import { desc } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { useFinanceData } from "@/lib/query/useFinanceData";
import { getRentalSettings } from "@/lib/settings";
import type { Booking, RentalSettings, Turnover } from "@/lib/rentals/types";
import { useWide } from "@/lib/appLayout";
import GlassCard from "@/components/GlassCard";
import PageHeader from "@/components/PageHeader";
import PageSkeleton from "@/components/PageSkeleton";
import EmptyState from "@/components/EmptyState";
import ErrorCard from "@/components/ErrorCard";
import { TurnoverCard } from "@/components/rentals/TurnoverCard";
import { TurnoverCreateForm } from "@/components/forms/rentals/TurnoverForms";
import { turnoverCandidates } from "@/lib/rentals/math";
import { RefreshCw, Plus, ChevronDown, ChevronUp, ArrowRight, X } from "lucide-react";

type PageData = {
  bookings: Booking[];
  turnovers: Turnover[];
  settings: RentalSettings;
};

async function load(): Promise<PageData> {
  const [bookings, turnovers, settings] = await Promise.all([
    db
      .select()
      .from(schema.rentalBookings)
      .orderBy(desc(schema.rentalBookings.checkInDate)),
    db
      .select()
      .from(schema.rentalTurnovers)
      .orderBy(desc(schema.rentalTurnovers.turnoverDate)),
    getRentalSettings(),
  ]);
  return {
    bookings: bookings as Booking[],
    turnovers: turnovers as Turnover[],
    settings,
  };
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-screen flex flex-col bg-[var(--background)] overflow-hidden">
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="mx-auto w-full max-w-6xl px-4 md:px-6 py-5 md:py-8 space-y-8">
          {children}
        </div>
      </div>
    </div>
  );
}

export default function TurnoversPage() {
  useWide(true);
  const { data, error, reload } = useFinanceData(
    ["rentals", "rentals:turnovers"],
    load,
  );
  const [showLog, setShowLog] = useState(false);

  if (error && !data) {
    return (
      <Shell>
        <PageHeader
          icon={RefreshCw}
          title="Turnovers"
          subtitle="Log costs, tick off cleaning, welcoming, keys."
        />
        <ErrorCard
          message="Couldn't load turnovers."
          onRetry={reload}
        />
      </Shell>
    );
  }

  if (!data) {
    return (
      <Shell>
        <PageSkeleton />
      </Shell>
    );
  }

  const { bookings, turnovers, settings } = data;

  const today = new Date().toISOString().slice(0, 10);
  const upcoming = turnovers.filter((t) => t.turnoverDate >= today);
  const past = turnovers.filter((t) => t.turnoverDate < today);
  const candidates = turnoverCandidates(bookings).filter(
    (c) =>
      c.date >= today &&
      !turnovers.some(
        (t) =>
          t.turnoverDate === c.date && t.bookingOutId === c.bookingOut.id,
      ),
  );

  return (
    <Shell>
      <PageHeader
        icon={RefreshCw}
        title="Turnovers"
        subtitle="Log costs, tick off cleaning, welcoming, keys."
      />

      <GlassCard padding={false}>
        <button
          type="button"
          onClick={() => setShowLog((v) => !v)}
          className="w-full px-4 sm:px-5 py-3.5 flex items-center justify-between gap-3 text-left hover:bg-white/[0.02] transition-colors rounded-2xl"
        >
          <span className="font-medium flex items-center gap-2">
            <Plus size={14} className="text-teal-300" /> Log a turnover
          </span>
          {showLog ? (
            <ChevronUp size={16} className="text-neutral-500" />
          ) : (
            <ChevronDown size={16} className="text-neutral-500" />
          )}
        </button>
        {showLog && (
          <div className="px-4 sm:px-5 pb-5 pt-1 border-t border-white/5">
            <div className="max-w-3xl">
              <TurnoverCreateForm
                bookings={bookings}
                settings={settings}
                onDone={() => setShowLog(false)}
              />
            </div>
          </div>
        )}
      </GlassCard>

      {candidates.length > 0 && (
        <GlassCard>
          <h2 className="font-medium">Suggested turnovers</h2>
          <p className="text-sm text-neutral-400 mt-1 mb-4 max-w-prose">
            From your calendar — checkouts coming up that don&apos;t have a
            turnover logged yet.
          </p>
          <ul className="space-y-2" aria-label="Suggested turnovers">
            {candidates.map((c) => (
              <li
                key={`${c.date}-${c.bookingOut.id}`}
                className="flex flex-col gap-2 rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2.5"
              >
                <SuggestionRow
                  candidate={c}
                  bookings={bookings}
                  settings={settings}
                />
              </li>
            ))}
          </ul>
        </GlassCard>
      )}

      <section className="space-y-3" aria-label="Upcoming turnovers">
        <h2 className="text-sm font-medium text-neutral-300">Upcoming</h2>
        {upcoming.length === 0 ? (
          <EmptyState
            icon={RefreshCw}
            title="No upcoming turnovers."
            hint="Log one above or accept a suggestion."
          />
        ) : (
          <div className="grid gap-3 xl:grid-cols-2">
            {upcoming.map((t) => (
              <TurnoverCard
                key={t.id}
                turnover={t}
                bookings={bookings}
                settings={settings}
              />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3" aria-label="Past turnovers">
        <h2 className="text-sm font-medium text-neutral-300">Past</h2>
        {past.length === 0 ? (
          <EmptyState icon={RefreshCw} title="No past turnovers yet." />
        ) : (
          <div className="grid gap-3 xl:grid-cols-2">
            {past.map((t) => (
              <TurnoverCard
                key={t.id}
                turnover={t}
                bookings={bookings}
                settings={settings}
              />
            ))}
          </div>
        )}
      </section>
    </Shell>
  );
}

function SuggestionRow({
  candidate,
  bookings,
  settings,
}: {
  candidate: ReturnType<typeof turnoverCandidates>[number];
  bookings: Booking[];
  settings: RentalSettings;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="flex items-center gap-3">
        <span className="font-mono text-xs text-teal-200 tabular-nums">
          {candidate.date}
        </span>
        <span className="text-sm truncate flex-1">
          {candidate.bookingOut.guestName}
          <ArrowRight size={12} className="inline mx-1.5 text-neutral-500" />
          {candidate.bookingIn ? candidate.bookingIn.guestName : "(empty)"}
        </span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="btn-ghost"
          aria-expanded={open}
        >
          {open ? (
            <>
              <X size={14} /> Cancel
            </>
          ) : (
            <>
              <Plus size={14} /> Log
            </>
          )}
        </button>
      </div>
      {open && (
        <div className="border-t border-white/5 pt-3 max-w-3xl">
          <TurnoverCreateForm
            bookings={bookings}
            settings={settings}
            defaultDate={candidate.date}
            defaultBookingOutId={candidate.bookingOut.id}
            defaultBookingInId={candidate.bookingIn?.id}
            onDone={() => setOpen(false)}
          />
        </div>
      )}
    </>
  );
}
