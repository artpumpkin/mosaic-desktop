"use client";
import { desc } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { useWide } from "@/lib/appLayout";
import { useFinanceData } from "@/lib/query/useFinanceData";
import type { Booking } from "@/lib/rentals/types";
import PageHeader from "@/components/PageHeader";
import PageSkeleton from "@/components/PageSkeleton";
import ErrorCard from "@/components/ErrorCard";
import { BookingsCalendar } from "@/components/rentals/BookingsCalendar";
import { BookingsTable } from "@/components/rentals/BookingsTable";
import { CalendarDays } from "lucide-react";

type PageData = { bookings: Booking[] };

async function load(): Promise<PageData> {
  const bookings = await db
    .select()
    .from(schema.rentalBookings)
    .orderBy(desc(schema.rentalBookings.checkInDate));
  return { bookings: bookings as Booking[] };
}

export default function CalendarPage() {
  useWide(true);
  const { data, error, reload } = useFinanceData(
    ["rentals", "rentals:bookings", "rentals:calendar"],
    load,
  );

  return (
    <div className="h-screen flex flex-col bg-[var(--background)] overflow-hidden">
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="w-full px-4 md:px-6 py-5 md:py-8 space-y-8">
          <PageHeader
            icon={CalendarDays}
            title="Calendar"
            subtitle="Click a day to add a booking — colored bands span booked nights."
          />
          {error ? (
            <ErrorCard message={error} onRetry={reload} />
          ) : !data ? (
            <PageSkeleton />
          ) : (
            <div className="grid gap-6 items-start 2xl:grid-cols-[1.7fr_1fr]">
              <BookingsCalendar bookings={data.bookings} />
              <BookingsTable bookings={data.bookings} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
