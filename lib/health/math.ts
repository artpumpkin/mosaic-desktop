export type Gender = "male" | "female";
export type ActivityLevel = "sedentary" | "light" | "moderate" | "very" | "extra";

export type BmiCategory = "underweight" | "normal" | "overweight" | "obese";

export const ACTIVITY_MULTIPLIER: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  very: 1.725,
  extra: 1.9,
};

export const ACTIVITY_LABEL: Record<ActivityLevel, string> = {
  sedentary: "Sedentary — desk job, little exercise",
  light: "Light — 1–3 workouts / week",
  moderate: "Moderate — 3–5 workouts / week",
  very: "Very active — 6–7 workouts / week",
  extra: "Extra active — physical job + training",
};

export function calcBmi(weightKg: number, heightCm: number): {
  value: number;
  category: BmiCategory;
} {
  if (!weightKg || !heightCm) return { value: 0, category: "normal" };
  const m = heightCm / 100;
  const value = weightKg / (m * m);
  let category: BmiCategory;
  if (value < 18.5) category = "underweight";
  else if (value < 25) category = "normal";
  else if (value < 30) category = "overweight";
  else category = "obese";
  return { value, category };
}

export function calcAgeYears(dobIso: string | null | undefined): number {
  if (!dobIso) return 0;
  const dob = new Date(dobIso);
  if (Number.isNaN(dob.getTime())) return 0;
  const now = new Date();
  let years = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) years--;
  return years;
}

/** Mifflin–St Jeor basal metabolic rate (kcal / day). */
export function calcBmr(args: {
  gender: Gender;
  weightKg: number;
  heightCm: number;
  ageYears: number;
}): number {
  const { gender, weightKg, heightCm, ageYears } = args;
  if (!weightKg || !heightCm || !ageYears) return 0;
  const base = 10 * weightKg + 6.25 * heightCm - 5 * ageYears;
  if (gender === "female") return base - 161;
  return base + 5;
}

/** Total daily energy expenditure (kcal / day). */
export function calcTdee(bmr: number, activity: ActivityLevel): number {
  if (!bmr) return 0;
  return bmr * (ACTIVITY_MULTIPLIER[activity] ?? 1);
}

/** kcal in roughly one kg of body fat. (Common nutrition-science approximation.) */
export const KCAL_PER_KG = 7700;

export type CalorieGoalKey =
  | "aggressive_loss"
  | "moderate_loss"
  | "mild_loss"
  | "maintain"
  | "mild_gain"
  | "moderate_gain";

export type CalorieGoal = {
  key: CalorieGoalKey;
  label: string;
  /** Daily delta from TDEE in kcal. Negative = deficit. */
  deltaKcal: number;
  /** Tailwind color family used by the UI cards. */
  tone: "rose" | "amber" | "emerald" | "sky" | "cyan" | "violet";
  /** Short helper line. */
  blurb: string;
};

export const CALORIE_GOALS: CalorieGoal[] = [
  {
    key: "aggressive_loss",
    label: "Aggressive loss",
    deltaKcal: -1000,
    tone: "rose",
    blurb: "Steep cut — hard to sustain.",
  },
  {
    key: "moderate_loss",
    label: "Steady loss",
    deltaKcal: -500,
    tone: "amber",
    blurb: "The classic ~1 lb/week cut.",
  },
  {
    key: "mild_loss",
    label: "Gentle loss",
    deltaKcal: -250,
    tone: "sky",
    blurb: "Slow and very sustainable.",
  },
  {
    key: "maintain",
    label: "Maintain",
    deltaKcal: 0,
    tone: "emerald",
    blurb: "Hold your current weight.",
  },
  {
    key: "mild_gain",
    label: "Lean gain",
    deltaKcal: 250,
    tone: "cyan",
    blurb: "Slow muscle-friendly surplus.",
  },
  {
    key: "moderate_gain",
    label: "Bulk",
    deltaKcal: 500,
    tone: "violet",
    blurb: "Faster gain, more fat to trim later.",
  },
];

export type CalorieTarget = {
  goal: CalorieGoal;
  kcal: number;
  /** Positive = weight gain, negative = weight loss. */
  weeklyKgChange: number;
};

export function calcCalorieTargets(tdee: number): CalorieTarget[] {
  if (!tdee) return [];
  return CALORIE_GOALS.map((goal) => {
    const kcal = Math.max(0, Math.round(tdee + goal.deltaKcal));
    const weeklyKgChange = (goal.deltaKcal * 7) / KCAL_PER_KG;
    return { goal, kcal, weeklyKgChange };
  });
}

/**
 * Weeks to reach `goalKg` from `currentKg` at a given weekly kg change.
 * Returns null if direction doesn't match (e.g. losing rate when goal is heavier)
 * or rate is effectively zero.
 */
export function weeksToGoal(
  currentKg: number,
  goalKg: number,
  weeklyKgChange: number,
): number | null {
  if (!currentKg || !goalKg) return null;
  const needed = goalKg - currentKg; // signed
  if (Math.abs(weeklyKgChange) < 1e-4) return null;
  if (Math.sign(needed) !== Math.sign(weeklyKgChange)) return null;
  return needed / weeklyKgChange;
}

/** TDEE at every activity level for the same BMR — for a "what if I moved more" comparison. */
export function tdeeAcrossActivityLevels(bmr: number): Record<ActivityLevel, number> {
  const out = {} as Record<ActivityLevel, number>;
  (Object.keys(ACTIVITY_MULTIPLIER) as ActivityLevel[]).forEach((k) => {
    out[k] = Math.round(bmr * ACTIVITY_MULTIPLIER[k]);
  });
  return out;
}
