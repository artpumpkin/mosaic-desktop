"use client";
import Link from "next/link";
import { desc } from "drizzle-orm";
import clsx from "clsx";
import { useWide } from "@/lib/appLayout";
import { db, schema } from "@/lib/db/client";
import {
  getHealthProfile,
  getUnitsPreference,
  type HealthProfile,
} from "@/lib/settings";
import { useFinanceData } from "@/lib/query/useFinanceData";
import {
  calcAgeYears,
  calcBmr,
  calcTdee,
  calcCalorieTargets,
  tdeeAcrossActivityLevels,
  ACTIVITY_LABEL,
  type ActivityLevel,
} from "@/lib/health/math";
import { formatWeight } from "@/lib/health/units";
import type { UnitsPreference } from "@/lib/health/units";
import GlassCard from "@/components/GlassCard";
import PageHeader from "@/components/PageHeader";
import PageSkeleton from "@/components/PageSkeleton";
import EmptyState from "@/components/EmptyState";
import ErrorCard from "@/components/ErrorCard";
import { CalorieTargetBar } from "@/components/health/CalorieTargetBar";
import { GoalProjection } from "@/components/health/GoalProjection";
import {
  Flame,
  Zap,
  Heart,
  TrendingUp,
  UserCog,
} from "lucide-react";

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
  return {
    profile,
    unitsPref,
    latestWeightKg: latestRows[0]?.weightKg ?? null,
  };
}

export default function MetabolismPage() {
  useWide(true);
  const { data, error, reload } = useFinanceData(
    ["metabolism", "health-profile", "weight", "settings"],
    load,
  );

  const editAction = (
    <Link href="/health/profile" className="btn-ghost">
      <UserCog size={14} strokeWidth={2} />
      Edit profile
    </Link>
  );

  let body: React.ReactNode;
  if (error && !data) {
    body = <ErrorCard message={error} onRetry={reload} />;
  } else if (!data) {
    body = <PageSkeleton />;
  } else {
    const { profile, unitsPref, latestWeightKg } = data;
    const ageYears = calcAgeYears(profile.dateOfBirth);
    const ready =
      latestWeightKg != null &&
      profile.heightCm != null &&
      !!profile.dateOfBirth &&
      ageYears > 0;

    body = !ready ? (
      <SetupHint profile={profile} hasWeight={latestWeightKg != null} />
    ) : (
      <MetabolismContent
        profile={profile}
        unitsPref={unitsPref}
        latestWeightKg={latestWeightKg}
        ageYears={ageYears}
      />
    );
  }

  return (
    <div className="h-screen flex flex-col bg-[var(--background)] overflow-hidden">
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="w-full px-4 md:px-6 py-5 md:py-8 space-y-8">
          <PageHeader
            icon={Flame}
            title="Metabolism"
            subtitle="Your engine — and what to feed it for the result you want."
            right={editAction}
          />
          {body}
        </div>
      </div>
    </div>
  );
}

function SetupHint({
  profile,
  hasWeight,
}: {
  profile: HealthProfile;
  hasWeight: boolean;
}) {
  const missing: { label: string; href: string }[] = [];
  if (!profile.heightCm) missing.push({ label: "height", href: "/health/profile" });
  if (!profile.dateOfBirth) missing.push({ label: "date of birth", href: "/health/profile" });
  if (!hasWeight) missing.push({ label: "a weight entry", href: "/health/weight" });

  return (
    <EmptyState
      icon={Flame}
      title="Set up your profile to compute BMR and TDEE"
      hint={
        <span>
          Add{" "}
          {missing.map((m, i) => (
            <span key={m.label}>
              {i > 0 && (i === missing.length - 1 ? " and " : ", ")}
              <Link
                href={m.href}
                className="text-emerald-300 hover:text-emerald-200 underline-offset-4 hover:underline"
              >
                {m.label}
              </Link>
            </span>
          ))}
          .
        </span>
      }
    />
  );
}

function MetabolismContent({
  profile,
  unitsPref,
  latestWeightKg,
  ageYears,
}: {
  profile: HealthProfile;
  unitsPref: UnitsPreference;
  latestWeightKg: number;
  ageYears: number;
}) {
  const bmr = Math.round(
    calcBmr({
      gender: profile.gender,
      weightKg: latestWeightKg,
      heightCm: profile.heightCm ?? 0,
      ageYears,
    }),
  );
  const tdee = Math.round(calcTdee(bmr, profile.activityLevel));
  const activeBurn = tdee - bmr;
  const targets = calcCalorieTargets(tdee);
  const tdeeByActivity = tdeeAcrossActivityLevels(bmr);

  return (
    <>
      {/* Hero — BMR + active burn + TDEE */}
      <GlassCard>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
          <HeroStat
            icon={<Heart size={15} className="text-rose-300" />}
            label="BMR"
            value={bmr.toLocaleString()}
            unit="kcal/day"
            sub="Energy you'd burn lying still for 24h."
          />
          <HeroStat
            icon={<Zap size={15} className="text-amber-300" />}
            label="Activity burn"
            value={`+${activeBurn.toLocaleString()}`}
            unit="kcal/day"
            sub={ACTIVITY_LABEL[profile.activityLevel]}
          />
          <HeroStat
            icon={<Flame size={15} className="text-emerald-300" />}
            label="TDEE"
            value={tdee.toLocaleString()}
            unit="kcal/day"
            sub="Total daily burn — your maintenance line."
            highlight
          />
        </div>
        <p className="mt-5 max-w-prose text-[11px] text-neutral-500 leading-relaxed">
          Computed with Mifflin–St Jeor from your latest weight ({formatWeight(latestWeightKg, unitsPref)}),
          height, {ageYears} years old, {profile.gender}, and {profile.activityLevel} activity. Update
          any of those in your profile to recompute.
        </p>
      </GlassCard>

      {/* Calorie target picker */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-neutral-300 flex items-center gap-2">
          <Flame size={14} className="text-emerald-300" />
          Daily calorie targets
        </h2>
        <CalorieTargetBar
          targets={targets}
          unitsPref={unitsPref}
          savedTargetKcal={profile.dailyCalorieTarget ?? null}
        />
      </section>

      {/* Goal projection */}
      {profile.goalWeightKg != null && (
        <GlassCard>
          <h2 className="font-medium mb-4 flex items-center gap-2">
            <TrendingUp size={15} className="text-emerald-300" /> Path to your goal
          </h2>
          <GoalProjection
            currentKg={latestWeightKg}
            goalKg={profile.goalWeightKg}
            targets={targets}
            unitsPref={unitsPref}
          />
        </GlassCard>
      )}

      {/* Activity-level what-if */}
      <GlassCard>
        <h2 className="font-medium mb-4 flex items-center gap-2">
          <Zap size={15} className="text-amber-300" /> If you moved more
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 max-w-5xl">
          {(Object.keys(tdeeByActivity) as ActivityLevel[]).map((lvl) => {
            const current = lvl === profile.activityLevel;
            const tdeeAtLvl = tdeeByActivity[lvl];
            const diff = tdeeAtLvl - tdee;
            return (
              <div
                key={lvl}
                className={clsx(
                  "rounded-xl border p-3 transition-colors",
                  current
                    ? "border-amber-400/40 bg-amber-500/[0.06]"
                    : "border-white/5 bg-white/[0.02]",
                )}
              >
                <div
                  className={clsx(
                    "text-[10px] uppercase tracking-wider font-medium capitalize",
                    current ? "text-amber-200" : "text-neutral-500",
                  )}
                >
                  {lvl === "very" ? "Very active" : lvl === "extra" ? "Extra active" : lvl}
                  {current && <span className="ml-1">·  you</span>}
                </div>
                <div className="mt-1.5 text-lg font-semibold tabular-nums">
                  {tdeeAtLvl.toLocaleString()}
                </div>
                {!current && diff !== 0 && (
                  <div
                    className={clsx(
                      "text-[11px] tabular-nums",
                      diff > 0 ? "text-emerald-300" : "text-neutral-500",
                    )}
                  >
                    {diff > 0 ? `+${diff}` : diff} vs now
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <p className="mt-3 max-w-prose text-[11px] text-neutral-500 leading-relaxed">
          Same body, different activity level. Moving from sedentary to moderately active is roughly{" "}
          {Math.round(tdeeByActivity.moderate - tdeeByActivity.sedentary).toLocaleString()} extra
          kcal burned per day — that&apos;s a free deficit you don&apos;t have to diet for.
        </p>
      </GlassCard>
    </>
  );
}

function HeroStat({
  icon,
  label,
  value,
  unit,
  sub,
  highlight,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  unit: string;
  sub: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={clsx(
        "rounded-2xl p-4 border",
        highlight
          ? "border-violet-400/30 bg-gradient-to-br from-violet-500/10 to-transparent"
          : "border-white/5 bg-white/[0.02]",
      )}
    >
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em] text-neutral-400">
        {icon}
        {label}
      </div>
      <div
        className={clsx(
          "mt-2 text-4xl font-semibold tabular-nums tracking-tight",
          highlight && "gradient-text",
        )}
      >
        {value}
      </div>
      <div className="text-xs text-neutral-500 mt-0.5">{unit}</div>
      <p className="mt-2 text-[11px] text-neutral-400 leading-snug">{sub}</p>
    </div>
  );
}
