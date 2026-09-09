import type { Booking, Turnover } from "./types";
import {
  bookingNightsInMonth,
  grossRevenueInMonth,
  totalCostsInMonth,
  netRevenueInMonth,
  daysInMonth,
  nightsBookedInMonth,
  occupancyPct,
} from "./math";

function quote(s: string | number | null | undefined): string {
  if (s === null || s === undefined) return "";
  const str = String(s);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function line(values: Array<string | number | null | undefined>): string {
  return values.map(quote).join(",");
}

export function monthlyReportCsv(
  bookings: Booking[],
  turnovers: Turnover[],
  year: number,
  month: number,
): string {
  const monthBookings = bookings.filter(
    (b) => bookingNightsInMonth(b, year, month) > 0,
  );
  const monthTurnovers = turnovers.filter((t) => {
    const d = new Date(t.turnoverDate + "T00:00:00Z");
    return d.getUTCFullYear() === year && d.getUTCMonth() === month;
  });
  const total = daysInMonth(year, month);
  const nights = nightsBookedInMonth(bookings, year, month);
  const gross = grossRevenueInMonth(bookings, year, month);
  const costs = totalCostsInMonth(turnovers, year, month);
  const net = netRevenueInMonth(bookings, turnovers, year, month);
  const monthLabel = new Date(Date.UTC(year, month, 1)).toLocaleDateString(
    undefined,
    { month: "long", year: "numeric" },
  );

  const out: string[] = [];
  out.push(`Monthly report — ${monthLabel}`);
  out.push("");
  out.push("Summary");
  out.push(line(["Nights booked", nights]));
  out.push(line(["Days in month", total]));
  out.push(line(["Occupancy %", occupancyPct(nights, total)]));
  out.push(line(["Gross revenue (MAD)", gross.toFixed(2)]));
  out.push(line(["Cleaner costs (MAD)", costs.cleaner.toFixed(2)]));
  out.push(line(["Fuel costs (MAD)", costs.fuel.toFixed(2)]));
  out.push(line(["Sweets costs (MAD)", costs.sweets.toFixed(2)]));
  out.push(line(["Other costs (MAD)", costs.other.toFixed(2)]));
  out.push(line(["Total costs (MAD)", costs.total.toFixed(2)]));
  out.push(line(["Net revenue (MAD)", net.toFixed(2)]));
  out.push("");

  out.push("Bookings");
  out.push(
    line([
      "Guest",
      "Check-in",
      "Check-out",
      "Nights (total)",
      "Nights (this month)",
      "Amount paid (MAD)",
      "Platform",
      "Status",
      "Note",
    ]),
  );
  for (const b of monthBookings) {
    out.push(
      line([
        b.guestName,
        b.checkInDate,
        b.checkOutDate,
        b.nights,
        bookingNightsInMonth(b, year, month),
        b.amountPaidMad.toFixed(2),
        b.platform,
        b.status,
        b.note ?? "",
      ]),
    );
  }
  out.push("");

  out.push("Turnovers");
  out.push(
    line([
      "Date",
      "Cleaner (MAD)",
      "Fuel (MAD)",
      "Sweets (MAD)",
      "Other (MAD)",
      "Other note",
      "Cleaning done",
      "Guest welcomed",
      "Keys returned",
      "Note",
    ]),
  );
  for (const t of monthTurnovers) {
    out.push(
      line([
        t.turnoverDate,
        t.cleanerCostMad.toFixed(2),
        t.fuelCostMad.toFixed(2),
        t.sweetsCostMad.toFixed(2),
        t.otherCostMad.toFixed(2),
        t.otherNote ?? "",
        t.cleaningDone ? "yes" : "no",
        t.guestWelcomed ? "yes" : "no",
        t.keysReturned ? "yes" : "no",
        t.note ?? "",
      ]),
    );
  }

  return out.join("\n") + "\n";
}

export function downloadCsv(filename: string, contents: string): void {
  const blob = new Blob([contents], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
