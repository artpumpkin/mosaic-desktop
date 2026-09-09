"use client";
import { desc } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { useFinanceData } from "@/lib/query/useFinanceData";
import { useWide } from "@/lib/appLayout";
import { getRentalSettings } from "@/lib/settings";
import type { RentalSettings, Turnover } from "@/lib/rentals/types";
import GlassCard from "@/components/GlassCard";
import PageHeader from "@/components/PageHeader";
import PageSkeleton from "@/components/PageSkeleton";
import ErrorCard from "@/components/ErrorCard";
import { RentalSettingsForm } from "@/components/forms/rentals/SettingsForm";
import { BreakEvenWidget } from "@/components/rentals/BreakEvenWidget";
import { WhatIfSimulator } from "@/components/rentals/WhatIfSimulator";
import { daysInMonth, totalCostsInMonth } from "@/lib/rentals/math";
import { SlidersHorizontal } from "lucide-react";

type PageData = {
  settings: RentalSettings;
  turnovers: Turnover[];
};

async function load(): Promise<PageData> {
  const [settings, turnovers] = await Promise.all([
    getRentalSettings(),
    db
      .select()
      .from(schema.rentalTurnovers)
      .orderBy(desc(schema.rentalTurnovers.turnoverDate)),
  ]);
  return { settings, turnovers: turnovers as Turnover[] };
}

export default function RentalSettingsPage() {
  useWide(true);
  const { data, error, reload } = useFinanceData(
    ["rentals", "rentals:settings", "rentals:turnovers"],
    load,
  );

  return (
    <div className="h-screen flex flex-col bg-[var(--background)] overflow-hidden">
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="w-full px-4 md:px-6 py-5 md:py-8 space-y-8">
          <PageHeader
            icon={SlidersHorizontal}
            title="Rental defaults"
            subtitle="Editable defaults, break-even calculator, and a what-if simulator."
          />

          {!data && error ? (
            <ErrorCard message={error} onRetry={reload} />
          ) : !data ? (
            <PageSkeleton />
          ) : (
            <SettingsContent data={data} />
          )}
        </div>
      </div>
    </div>
  );
}

function SettingsContent({ data }: { data: PageData }) {
  const { settings, turnovers } = data;

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const total = daysInMonth(year, month);

  // Average monthly cost from the last 3 months.
  let sum = 0;
  let counted = 0;
  for (let i = 0; i < 3; i++) {
    const d = new Date(Date.UTC(year, month - i, 1));
    const c = totalCostsInMonth(turnovers, d.getUTCFullYear(), d.getUTCMonth()).total;
    if (c > 0) {
      sum += c;
      counted++;
    }
  }
  const avgMonthlyCosts =
    counted > 0
      ? sum / counted
      : settings.cleanerDefaultMad + settings.fuelDefaultMad + settings.sweetsDefaultMad;

  return (
    <>
      <GlassCard>
        <h2 className="font-medium mb-2">Defaults</h2>
        <p className="text-sm text-neutral-400 mb-4 max-w-prose">
          Baseline nightly rate and per-turnover costs used across the rentals section.
        </p>
        {/* Form fields cap at 2-3 cols internally; constrain so a lone
            number input never stretches across an ultrawide pane. */}
        <div className="max-w-3xl">
          <RentalSettingsForm initial={settings} />
        </div>
      </GlassCard>

      <div className="grid gap-6 lg:grid-cols-2 items-start">
        <BreakEvenWidget
          monthlyFixedCosts={avgMonthlyCosts}
          nightlyRate={settings.nightlyRateMad}
          daysInMonth={total}
        />
        <WhatIfSimulator settings={settings} daysInMonth={total} />
      </div>
    </>
  );
}
