"use client";
import { Download } from "lucide-react";
import type { Booking, Turnover } from "@/lib/rentals/types";
import { downloadCsv, monthlyReportCsv } from "@/lib/rentals/csv";

export function ExportCsvButton({
  bookings,
  turnovers,
  year,
  month,
}: {
  bookings: Booking[];
  turnovers: Turnover[];
  year: number;
  month: number;
}) {
  function onClick() {
    const csv = monthlyReportCsv(bookings, turnovers, year, month);
    const monthLabel = new Date(Date.UTC(year, month, 1))
      .toISOString()
      .slice(0, 7);
    downloadCsv(`rentals-${monthLabel}.csv`, csv);
  }
  return (
    <button type="button" onClick={onClick} className="btn-ghost">
      <Download size={14} /> Export CSV
    </button>
  );
}
