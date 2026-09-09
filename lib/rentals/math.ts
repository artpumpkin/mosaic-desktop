import type { Booking, Turnover, RentalSettings } from "./types";

const MS_PER_DAY = 86_400_000;

function parseIsoDate(d: string): Date {
  return new Date(d + "T00:00:00Z");
}

export function nightsBetween(checkIn: string, checkOut: string): number {
  const a = parseIsoDate(checkIn).getTime();
  const b = parseIsoDate(checkOut).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0;
  return Math.round((b - a) / MS_PER_DAY);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

export function fuelCostPerTrip(
  distanceKm: number,
  lPer100km: number,
  pricePerL: number,
): number {
  return (distanceKm * lPer100km * pricePerL) / 100;
}

/**
 * Nights of a booking that fall within the given calendar month
 * (month is 0-indexed). Splits stays crossing month boundaries.
 */
export function bookingNightsInMonth(
  booking: Booking,
  year: number,
  month: number,
): number {
  if (booking.status === "cancelled") return 0;
  const inDate = parseIsoDate(booking.checkInDate);
  const outDate = parseIsoDate(booking.checkOutDate);
  const monthStart = Date.UTC(year, month, 1);
  const monthEnd = Date.UTC(year, month + 1, 1);
  const overlapStart = Math.max(inDate.getTime(), monthStart);
  const overlapEnd = Math.min(outDate.getTime(), monthEnd);
  if (overlapEnd <= overlapStart) return 0;
  return Math.round((overlapEnd - overlapStart) / MS_PER_DAY);
}

export function nightsBookedInMonth(
  bookings: Booking[],
  year: number,
  month: number,
): number {
  return bookings.reduce((sum, b) => sum + bookingNightsInMonth(b, year, month), 0);
}

export function occupancyPct(nightsBooked: number, totalNights: number): number {
  if (totalNights <= 0) return 0;
  return Math.min(100, Math.round((nightsBooked / totalNights) * 1000) / 10);
}

/**
 * Revenue assigned to a calendar month is amountPaid * (nights-in-month / total-nights).
 * Cancelled bookings contribute 0.
 */
export function grossRevenueInMonth(
  bookings: Booking[],
  year: number,
  month: number,
): number {
  let total = 0;
  for (const b of bookings) {
    if (b.status === "cancelled" || b.nights <= 0) continue;
    const portion = bookingNightsInMonth(b, year, month) / b.nights;
    if (portion <= 0) continue;
    total += b.amountPaidMad * portion;
  }
  return total;
}

export type CostBreakdown = {
  cleaner: number;
  fuel: number;
  sweets: number;
  other: number;
  total: number;
};

export function totalCostsInMonth(
  turnovers: Turnover[],
  year: number,
  month: number,
): CostBreakdown {
  const out: CostBreakdown = { cleaner: 0, fuel: 0, sweets: 0, other: 0, total: 0 };
  for (const t of turnovers) {
    const d = parseIsoDate(t.turnoverDate);
    if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month) continue;
    out.cleaner += t.cleanerCostMad;
    out.fuel += t.fuelCostMad;
    out.sweets += t.sweetsCostMad;
    out.other += t.otherCostMad;
  }
  out.total = out.cleaner + out.fuel + out.sweets + out.other;
  return out;
}

export function netRevenueInMonth(
  bookings: Booking[],
  turnovers: Turnover[],
  year: number,
  month: number,
): number {
  return (
    grossRevenueInMonth(bookings, year, month) -
    totalCostsInMonth(turnovers, year, month).total
  );
}

export function breakEvenNights(monthlyFixedCosts: number, nightlyRate: number): number {
  if (nightlyRate <= 0) return 0;
  return Math.ceil(monthlyFixedCosts / nightlyRate);
}

/**
 * Project net for a month given an occupancy %, assuming one turnover per
 * average stay (3 nights default), each with default per-turnover costs.
 */
export function projectedNet(
  occupancyPctValue: number,
  settings: RentalSettings,
  totalDays: number,
  avgStayNights = 3,
): number {
  const nights = (occupancyPctValue / 100) * totalDays;
  const gross = nights * settings.nightlyRateMad;
  const turnovers = avgStayNights > 0 ? nights / avgStayNights : 0;
  const costPerTurnover =
    settings.cleanerDefaultMad + settings.fuelDefaultMad + settings.sweetsDefaultMad;
  return gross - turnovers * costPerTurnover;
}

export type TrendPoint = {
  year: number;
  month: number;
  label: string;
  gross: number;
  net: number;
};

export function trendlineLastNMonths(
  bookings: Booking[],
  turnovers: Turnover[],
  n: number,
  now: Date = new Date(),
): TrendPoint[] {
  const out: TrendPoint[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    const gross = grossRevenueInMonth(bookings, y, m);
    const costs = totalCostsInMonth(turnovers, y, m).total;
    out.push({
      year: y,
      month: m,
      label: d.toLocaleDateString(undefined, { month: "short" }),
      gross,
      net: gross - costs,
    });
  }
  return out;
}

/**
 * Pair bookings into turnover candidates: a checkout that is followed by another
 * booking's checkin within `windowDays`. Sorted by date ascending.
 */
export type TurnoverCandidate = {
  date: string;
  bookingOut: Booking;
  bookingIn: Booking | null;
};

export function turnoverCandidates(
  bookings: Booking[],
  windowDays = 1,
): TurnoverCandidate[] {
  const active = bookings.filter((b) => b.status !== "cancelled");
  const byCheckIn = [...active].sort((a, b) =>
    a.checkInDate.localeCompare(b.checkInDate),
  );
  const out: TurnoverCandidate[] = [];
  for (const b of active) {
    const outDate = parseIsoDate(b.checkOutDate).getTime();
    const next = byCheckIn.find((other) => {
      if (other.id === b.id) return false;
      const inDate = parseIsoDate(other.checkInDate).getTime();
      const gap = (inDate - outDate) / MS_PER_DAY;
      return gap >= 0 && gap <= windowDays;
    });
    out.push({ date: b.checkOutDate, bookingOut: b, bookingIn: next ?? null });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
