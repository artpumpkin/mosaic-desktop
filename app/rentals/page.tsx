"use client";
import { desc } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { useFinanceData } from "@/lib/query/useFinanceData";
import { useWide } from "@/lib/appLayout";
import { getRentalSettings } from "@/lib/settings";
import type { Booking, RentalSettings, Turnover } from "@/lib/rentals/types";
import {
  daysInMonth,
  grossRevenueInMonth,
  netRevenueInMonth,
  nightsBookedInMonth,
  occupancyPct,
  totalCostsInMonth,
  trendlineLastNMonths,
} from "@/lib/rentals/math";
import GlassCard from "@/components/GlassCard";
import PageHeader from "@/components/PageHeader";
import PageSkeleton from "@/components/PageSkeleton";
import EmptyState from "@/components/EmptyState";
import ErrorCard from "@/components/ErrorCard";
import { MonthlyKpis } from "@/components/rentals/MonthlyKpis";
import { RevenueTrendChart } from "@/components/rentals/RevenueTrendChart";
import { CostBreakdownChart } from "@/components/rentals/CostBreakdownChart";
import { ExportCsvButton } from "@/components/rentals/ExportCsvButton";
import { KeyRound, BarChart3, TrendingUp, CalendarPlus } from "lucide-react";
import Link from "next/link";

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
        <div className="mx-auto w-full max-w-7xl px-4 md:px-6 py-5 md:py-8 space-y-8">
          {children}
        </div>
      </div>
    </div>
  );
}

export default function RentalsDashboard() {
  useWide(true);
  const { data, error, reload } = useFinanceData(["rentals"], load);

  if (error) {
    return (
      <Shell>
        <PageHeader
          icon={KeyRound}
          title="Rentals"
          subtitle="Track bookings, turnovers, and net revenue for your rental."
        />
        <ErrorCard message={error} onRetry={reload} />
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

  const { bookings, turnovers } = data;

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const total = daysInMonth(year, month);

  const nights = nightsBookedInMonth(bookings, year, month);
  const occupancy = occupancyPct(nights, total);
  const gross = grossRevenueInMonth(bookings, year, month);
  const costs = totalCostsInMonth(turnovers, year, month);
  const net = netRevenueInMonth(bookings, turnovers, year, month);
  const trend = trendlineLastNMonths(bookings, turnovers, 6, now);

  const noData = bookings.length === 0 && turnovers.length === 0;

  return (
    <Shell>
      <PageHeader
        icon={KeyRound}
        title="Rentals"
        subtitle="Track bookings, turnovers, and net revenue for your rental."
        right={
          <ExportCsvButton
            bookings={bookings}
            turnovers={turnovers}
            year={year}
            month={month}
          />
        }
      />

      {noData ? (
        <EmptyState
          icon={CalendarPlus}
          title="No rental activity yet."
          hint="Add your first booking to start tracking occupancy, revenue, and costs."
          action={
            <Link href="/rentals/calendar" className="btn-primary">
              <CalendarPlus size={14} /> Add a booking
            </Link>
          }
        />
      ) : (
        <>
          <MonthlyKpis
            nightsBooked={nights}
            totalNights={total}
            occupancy={occupancy}
            gross={gross}
            costs={costs.total}
            net={net}
          />

          <div className="grid gap-6 xl:grid-cols-2 items-start">
            <GlassCard>
              <h2 className="font-medium flex items-center gap-2">
                <TrendingUp size={15} className="text-teal-300" /> Revenue trend
              </h2>
              <p className="text-xs text-neutral-400 mt-1 mb-4">
                Last 6 months — gross vs net.
              </p>
              <RevenueTrendChart data={trend} />
            </GlassCard>

            <GlassCard>
              <h2 className="font-medium flex items-center gap-2">
                <BarChart3 size={15} className="text-teal-300" /> Cost breakdown
              </h2>
              <p className="text-xs text-neutral-400 mt-1 mb-4">
                Where this month&apos;s costs went.
              </p>
              <CostBreakdownChart costs={costs} />
            </GlassCard>
          </div>

          <GlassCard>
            <h2 className="font-medium mb-4">Jump in</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <QuickLink
                href="/rentals/calendar"
                label="Calendar"
                sub="Add or edit a booking"
              />
              <QuickLink
                href="/rentals/turnovers"
                label="Turnovers"
                sub="Log costs & check off tasks"
              />
              <QuickLink
                href="/rentals/settings"
                label="Defaults"
                sub="Rates & simulator"
              />
            </div>
          </GlassCard>
        </>
      )}
    </Shell>
  );
}

function QuickLink({
  href,
  label,
  sub,
}: {
  href: string;
  label: string;
  sub: string;
}) {
  return (
    <Link
      href={href}
      className="rounded-xl border border-white/5 bg-white/[0.02] hover:bg-white/[0.05] hover:border-teal-400/20 transition-colors px-4 py-3 flex flex-col gap-0.5"
    >
      <span className="font-medium text-sm">{label}</span>
      <span className="text-xs text-neutral-500">{sub}</span>
    </Link>
  );
}
