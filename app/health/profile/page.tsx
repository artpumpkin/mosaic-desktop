"use client";
import { desc } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { getHealthProfile, getUnitsPreference, type HealthProfile } from "@/lib/settings";
import type { UnitsPreference } from "@/lib/health/units";
import { formatWeight, formatHeight } from "@/lib/health/units";
import {
  calcAgeYears,
  calcBmi,
  calcBmr,
  calcTdee,
  type BmiCategory,
} from "@/lib/health/math";
import { useFinanceData } from "@/lib/query/useFinanceData";
import { useWide } from "@/lib/appLayout";
import GlassCard from "@/components/GlassCard";
import PageHeader from "@/components/PageHeader";
import PageSkeleton from "@/components/PageSkeleton";
import ErrorCard from "@/components/ErrorCard";
import { HealthProfileForm } from "@/components/forms/health/ProfileForms";
import { UserCog } from "lucide-react";
import type { ReactNode } from "react";

type PageData = {
  profile: HealthProfile;
  unitsPref: UnitsPreference;
  latestWeightKg: number | null;
};

async function load(): Promise<PageData> {
  const [profile, unitsPref, latestRows] = await Promise.all([
    getHealthProfile(),
    getUnitsPreference(),
    db
      .select()
      .from(schema.weightEntries)
      .orderBy(desc(schema.weightEntries.recordedAt))
      .limit(1),
  ]);
  return { profile, unitsPref, latestWeightKg: latestRows[0]?.weightKg ?? null };
}

const BMI_TONE: Record<BmiCategory, string> = {
  underweight: "text-sky-300",
  normal: "text-emerald-300",
  overweight: "text-amber-300",
  obese: "text-rose-300",
};

const BMI_LABEL: Record<BmiCategory, string> = {
  underweight: "Underweight",
  normal: "Normal",
  overweight: "Overweight",
  obese: "Obese",
};

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="h-screen flex flex-col bg-[var(--background)] overflow-hidden">
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="w-full px-4 md:px-6 py-5 md:py-8 space-y-8">
          {children}
        </div>
      </div>
    </div>
  );
}

const Header = (
  <PageHeader
    icon={UserCog}
    title="Health profile"
    subtitle="Used to compute BMI, BMR, and your suggested daily calorie target."
  />
);

function HeroStat({
  label,
  value,
  unit,
  sub,
  tone,
}: {
  label: string;
  value: string;
  unit?: string;
  sub?: string;
  tone?: string;
}) {
  return (
    <div className="rounded-xl bg-white/[0.02] border border-white/5 p-4">
      <div className="text-[11px] uppercase tracking-wider text-neutral-500">{label}</div>
      <div className={`mt-1 text-3xl sm:text-4xl font-semibold tracking-tight tabular-nums ${tone ?? ""}`}>
        {value}
        {unit && <span className="ml-1 text-base font-normal text-neutral-500">{unit}</span>}
      </div>
      {sub && <div className="mt-1 text-[11px] text-neutral-500">{sub}</div>}
    </div>
  );
}

function HeroStrip({ data }: { data: PageData }) {
  const { profile, unitsPref, latestWeightKg } = data;
  const weightKg =
    latestWeightKg != null && latestWeightKg > 0
      ? latestWeightKg
      : profile.goalWeightKg ?? 0;
  const heightCm = profile.heightCm ?? 0;
  const age = calcAgeYears(profile.dateOfBirth);

  const bmi = weightKg && heightCm ? calcBmi(weightKg, heightCm) : null;
  const bmr = calcBmr({
    gender: profile.gender,
    weightKg,
    heightCm,
    ageYears: age,
  });
  const tdee = calcTdee(bmr, profile.activityLevel);
  const target =
    profile.dailyCalorieTarget != null
      ? profile.dailyCalorieTarget
      : tdee
        ? Math.round(tdee - 500)
        : 0;

  const weightSub =
    latestWeightKg != null && latestWeightKg > 0
      ? `from latest log · ${formatWeight(weightKg, unitsPref)}`
      : profile.goalWeightKg != null
        ? `from goal · ${formatWeight(weightKg, unitsPref)}`
        : "log a weight to enable";

  return (
    <GlassCard>
      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-2 2xl:grid-cols-4 gap-4">
        <HeroStat
          label="BMI"
          value={bmi ? bmi.value.toFixed(1) : "—"}
          tone={bmi ? BMI_TONE[bmi.category] : undefined}
          sub={bmi ? BMI_LABEL[bmi.category] : weightSub}
        />
        <HeroStat
          label="BMR"
          value={bmr ? String(Math.round(bmr)) : "—"}
          unit={bmr ? "kcal" : undefined}
          sub="resting burn"
        />
        <HeroStat
          label="TDEE"
          value={tdee ? String(Math.round(tdee)) : "—"}
          unit={tdee ? "kcal" : undefined}
          sub="maintenance"
        />
        <HeroStat
          label="Daily target"
          value={target ? String(target) : "—"}
          unit={target ? "kcal" : undefined}
          tone={target ? "text-emerald-300" : undefined}
          sub={profile.dailyCalorieTarget != null ? "custom" : "auto · TDEE − 500"}
        />
      </div>
      {(!heightCm || !age || !weightKg) && (
        <p className="mt-4 max-w-prose text-[11px] text-neutral-500">
          Fill in height, date of birth{latestWeightKg == null ? ", and log a weight" : ""} below to
          complete these metrics.
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-neutral-500">
        <span>Height: {formatHeight(heightCm, unitsPref)}</span>
        <span>Age: {age ? `${age} yr` : "—"}</span>
        <span>Goal: {profile.goalWeightKg != null ? formatWeight(profile.goalWeightKg, unitsPref) : "—"}</span>
      </div>
    </GlassCard>
  );
}

export default function HealthProfilePage() {
  useWide(true);
  const { data, error, reload } = useFinanceData(
    ["health-profile", "weight", "settings"],
    load,
  );

  if (error && !data) {
    return (
      <Shell>
        {Header}
        <ErrorCard message={error} onRetry={reload} />
      </Shell>
    );
  }

  if (!data) {
    return (
      <Shell>
        {Header}
        <PageSkeleton />
      </Shell>
    );
  }

  return (
    <Shell>
      {Header}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] xl:items-start">
        <div className="space-y-6 xl:order-2">
          <HeroStrip data={data} />
        </div>

        <GlassCard className="xl:order-1">
          <h2 className="font-medium mb-4">Your details</h2>
          <div className="max-w-3xl">
            <HealthProfileForm
              initial={data.profile}
              unitsPref={data.unitsPref}
              latestWeightKg={data.latestWeightKg}
            />
          </div>
        </GlassCard>
      </div>
    </Shell>
  );
}
