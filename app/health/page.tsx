"use client";
import { useState } from "react";
import Link from "next/link";
import { desc } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { getHealthProfile, getUnitsPreference, type HealthProfile } from "@/lib/settings";
import { useFinanceData } from "@/lib/query/useFinanceData";
import { latestEntry, recentAverage } from "@/lib/health/stats";
import { calcAgeYears, calcBmr, calcTdee } from "@/lib/health/math";
import { formatWeight, formatWeightDelta } from "@/lib/health/units";
import type { UnitsPreference } from "@/lib/health/units";
import { useWide } from "@/lib/appLayout";
import GlassCard from "@/components/GlassCard";
import PageHeader from "@/components/PageHeader";
import PageSkeleton from "@/components/PageSkeleton";
import ErrorCard from "@/components/ErrorCard";
import { BmiCard } from "@/components/health/BmiCard";
import { OtherBmiSection } from "@/components/health/OtherBmiSection";
import { WeightChart } from "@/components/health/WeightChart";
import {
  Activity,
  Scale,
  Flame,
  UserCog,
  ChevronRight,
  ChevronDown,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import clsx from "clsx";

type WeightRow = typeof schema.weightEntries.$inferSelect;
type PageData = {
  weights: WeightRow[];
  profile: HealthProfile;
  unitsPref: UnitsPreference;
};

async function load(): Promise<PageData> {
  const [weights, profile, unitsPref] = await Promise.all([
    db
      .select()
      .from(schema.weightEntries)
      .orderBy(desc(schema.weightEntries.recordedAt)),
    getHealthProfile(),
    getUnitsPreference(),
  ]);
  return { weights, profile, unitsPref };
}

export default function HealthOverview() {
  useWide(true);
  const { data, error, reload } = useFinanceData(
    ["health-overview", "weight", "health-profile"],
    load,
  );
  const [calcOpen, setCalcOpen] = useState(false);

  return (
    <div className="h-screen flex flex-col bg-[var(--background)] overflow-hidden">
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="w-full px-4 md:px-6 py-5 md:py-8 space-y-8">
          {!data ? (
            error ? (
              <ErrorCard message={error} onRetry={reload} />
            ) : (
              <PageSkeleton />
            )
          ) : (
            <HealthContent
              data={data}
              calcOpen={calcOpen}
              onToggleCalc={() => setCalcOpen((v) => !v)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function HealthContent({
  data,
  calcOpen,
  onToggleCalc,
}: {
  data: PageData;
  calcOpen: boolean;
  onToggleCalc: () => void;
}) {
  const { weights, profile, unitsPref } = data;

  const latest = latestEntry(weights);
  const avg5 = recentAverage(weights, 5);
  const delta = latest && avg5 ? latest.weightKg - avg5 : null;

  let tdee = 0;
  if (latest && profile.heightCm && profile.dateOfBirth) {
    const bmr = calcBmr({
      gender: profile.gender,
      weightKg: latest.weightKg,
      heightCm: profile.heightCm,
      ageYears: calcAgeYears(profile.dateOfBirth),
    });
    tdee = Math.round(calcTdee(bmr, profile.activityLevel));
  }
  const target =
    profile.dailyCalorieTarget ?? (tdee > 0 ? Math.max(0, tdee - 500) : 0);

  const profileIncomplete = !profile.heightCm || !profile.dateOfBirth;

  return (
    <>
      <PageHeader
        icon={Activity}
        title="Health"
        subtitle="Weight, metabolism, BMI — at a glance."
        right={
          <Link href="/health/profile" className="btn-ghost">
            <UserCog size={14} />
            Edit profile
          </Link>
        }
      />

      {profileIncomplete && (
        <Link
          href="/health/profile"
          className="flex items-center justify-between gap-3 rounded-xl border border-amber-400/20 bg-amber-500/[0.06] px-4 py-3 hover:bg-amber-500/[0.1] transition-colors max-w-3xl"
        >
          <span className="text-sm text-amber-200">
            Set your height and date of birth to unlock BMR/TDEE.
          </span>
          <ChevronRight size={15} className="text-amber-300/70 shrink-0" />
        </Link>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <DomainCard href="/health/weight" icon={Scale} title="Weight">
          {latest ? (
            <>
              <div className="text-3xl font-semibold tabular-nums">
                {formatWeight(latest.weightKg, unitsPref)}
              </div>
              {delta != null ? (
                <div
                  className={clsx(
                    "text-xs tabular-nums mt-1",
                    delta > 0
                      ? "text-rose-300"
                      : delta < 0
                        ? "text-emerald-300"
                        : "text-neutral-500",
                  )}
                >
                  {formatWeightDelta(delta, unitsPref)} vs 5-day avg
                </div>
              ) : (
                <div className="text-xs text-neutral-500 mt-1">No comparisons yet.</div>
              )}
            </>
          ) : (
            <div className="text-sm text-neutral-400">
              No weight logged yet — add one to start tracking.
            </div>
          )}
        </DomainCard>

        <DomainCard href="/health/weight" icon={Activity} title="BMI">
          <BmiCard weightKg={latest?.weightKg ?? null} heightCm={profile.heightCm} />
        </DomainCard>

        <DomainCard href="/health/metabolism" icon={Flame} title="Metabolism">
          {tdee > 0 ? (
            <>
              <div className="text-3xl font-semibold tabular-nums">
                {tdee.toLocaleString()}
                <span className="text-sm text-neutral-500 font-normal ml-1">kcal</span>
              </div>
              <div className="text-xs text-neutral-500 mt-1 tabular-nums">
                TDEE · target {target.toLocaleString()} kcal/day
              </div>
            </>
          ) : (
            <div className="text-sm text-neutral-400">
              Set height, DOB and a weight to see your BMR/TDEE.
            </div>
          )}
        </DomainCard>
      </div>

      <GlassCard>
        <div className="flex items-center justify-between gap-3 mb-4">
          <h2 className="font-medium">30-day weight trend</h2>
          <Link
            href="/health/weight"
            className="text-xs text-neutral-400 hover:text-neutral-200 flex items-center gap-1 shrink-0"
          >
            Open weight tracker <ChevronRight size={13} />
          </Link>
        </div>
        <WeightChart
          entries={weights}
          unitsPref={unitsPref}
          rangeDays={30}
          heightClass="h-56 sm:h-64 lg:h-72 2xl:h-80"
        />
      </GlassCard>

      <GlassCard padding={false}>
        <button
          type="button"
          onClick={onToggleCalc}
          className="w-full px-4 sm:px-5 py-3.5 flex items-center justify-between gap-3 text-left"
          aria-expanded={calcOpen}
        >
          <div className="flex items-center gap-2">
            <Users size={15} className="text-emerald-300" />
            <h2 className="font-medium">BMI calculator</h2>
            <span className="text-[11px] text-neutral-500">
              Check anyone else&apos;s BMI
            </span>
          </div>
          <ChevronDown
            size={16}
            className={clsx(
              "text-neutral-500 transition-transform shrink-0",
              calcOpen && "rotate-180",
            )}
          />
        </button>
        {calcOpen && (
          <div className="px-4 sm:px-5 pb-5 pt-1 border-t border-white/5">
            <OtherBmiSection unitsPref={unitsPref} />
          </div>
        )}
      </GlassCard>
    </>
  );
}

function DomainCard({
  href,
  icon: Icon,
  title,
  children,
}: {
  href: string;
  icon: LucideIcon;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} className="block">
      <GlassCard hover className="h-full">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-neutral-400 mb-2">
          <Icon size={14} className="text-emerald-300" />
          {title}
        </div>
        {children}
      </GlassCard>
    </Link>
  );
}
