import { db, schema } from "@/lib/db/client";
import { eq } from "drizzle-orm";
import type { ActivityLevel, Gender } from "@/lib/health/math";
import type { UnitsPreference } from "@/lib/health/units";
import {
  DEFAULT_RENTAL_SETTINGS,
  type RentalSettings,
} from "@/lib/rentals/types";
import {
  DEFAULT_TV_SOURCES_STATE,
  BUILTIN_IPTV_ORG_ID,
  type TvSourcesState,
  type TvSource,
} from "@/lib/tv/sources";
import {
  DEFAULT_MANGA_SOURCES_STATE,
  BUILTIN_IDS as MANGA_BUILTIN_IDS,
} from "@/lib/manga/sources";
import type {
  MangaSource,
  MangaSourcesState,
  ExtRepo,
  InstalledExtension,
} from "@/lib/manga/types";

export const DEFAULT_BASE_CURRENCY = "MAD";
export const SUPPORTED_BASE_CURRENCIES = ["MAD", "AED", "USD", "EUR"] as const;
export type BaseCurrency = (typeof SUPPORTED_BASE_CURRENCIES)[number];

const BASE_CURRENCY_KEY = "baseCurrency";
const ALCHEMY_KEY = "alchemyApiKey";
const REALDEBRID_KEY = "realDebridApiKey";
const UNITS_KEY = "units.preference";

const HEALTH_HEIGHT_CM = "health.heightCm";
const HEALTH_GENDER = "health.gender";
const HEALTH_DOB = "health.dateOfBirth";
const HEALTH_ACTIVITY = "health.activityLevel";
const HEALTH_GOAL_WEIGHT_KG = "health.goalWeightKg";
const HEALTH_DAILY_KCAL_TARGET = "health.dailyCalorieTarget";

const RENTAL_SETTINGS_KEY = "rental:settings";
const TV_SOURCES_KEY = "tv:sources";
const MANGA_SOURCES_KEY = "manga:sources";
const MANGA_REPOS_KEY = "manga:repos";
const MANGA_EXTENSIONS_KEY = "manga:extensions";

async function getSetting(key: string): Promise<string | null> {
  const row = await db
    .select()
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, key))
    .limit(1);
  return row[0]?.value ?? null;
}

async function setSetting(key: string, value: string): Promise<void> {
  await db
    .insert(schema.appSettings)
    .values({ key, value })
    .onConflictDoUpdate({
      target: schema.appSettings.key,
      set: { value },
    });
}

async function deleteSetting(key: string): Promise<void> {
  await db.delete(schema.appSettings).where(eq(schema.appSettings.key, key));
}

// --- base currency ---------------------------------------------------------
export async function getBaseCurrency(): Promise<BaseCurrency> {
  const v = (await getSetting(BASE_CURRENCY_KEY)) as BaseCurrency | null;
  if (v && (SUPPORTED_BASE_CURRENCIES as readonly string[]).includes(v)) return v;
  return DEFAULT_BASE_CURRENCY;
}

export async function setBaseCurrency(value: string): Promise<void> {
  const upper = value.toUpperCase();
  if (!(SUPPORTED_BASE_CURRENCIES as readonly string[]).includes(upper)) {
    throw new Error("Unsupported base currency");
  }
  await setSetting(BASE_CURRENCY_KEY, upper);
}

// --- alchemy --------------------------------------------------------------
export async function getAlchemyApiKey(): Promise<string | null> {
  return getSetting(ALCHEMY_KEY);
}

export async function setAlchemyApiKey(value: string): Promise<void> {
  const trimmed = value.trim();
  if (!trimmed) {
    await deleteSetting(ALCHEMY_KEY);
    return;
  }
  await setSetting(ALCHEMY_KEY, trimmed);
}

// --- real-debrid ----------------------------------------------------------
export async function getRealDebridApiKey(): Promise<string | null> {
  return getSetting(REALDEBRID_KEY);
}

export async function setRealDebridApiKey(value: string): Promise<void> {
  const trimmed = value.trim();
  if (!trimmed) {
    await deleteSetting(REALDEBRID_KEY);
    return;
  }
  await setSetting(REALDEBRID_KEY, trimmed);
}

// --- units preference -----------------------------------------------------
export async function getUnitsPreference(): Promise<UnitsPreference> {
  const v = await getSetting(UNITS_KEY);
  return v === "imperial" ? "imperial" : "metric";
}

export async function setUnitsPreference(value: UnitsPreference): Promise<void> {
  await setSetting(UNITS_KEY, value === "imperial" ? "imperial" : "metric");
}

// --- health profile -------------------------------------------------------
export type HealthProfile = {
  heightCm: number | null;
  gender: Gender;
  dateOfBirth: string | null;
  activityLevel: ActivityLevel;
  goalWeightKg: number | null;
  dailyCalorieTarget: number | null;
};

const SUPPORTED_ACTIVITY: ActivityLevel[] = [
  "sedentary",
  "light",
  "moderate",
  "very",
  "extra",
];

export async function getHealthProfile(): Promise<HealthProfile> {
  const [height, gender, dob, activity, goal, target] = await Promise.all([
    getSetting(HEALTH_HEIGHT_CM),
    getSetting(HEALTH_GENDER),
    getSetting(HEALTH_DOB),
    getSetting(HEALTH_ACTIVITY),
    getSetting(HEALTH_GOAL_WEIGHT_KG),
    getSetting(HEALTH_DAILY_KCAL_TARGET),
  ]);
  const normalizedGender: Gender = gender === "female" ? "female" : "male";
  const normalizedActivity: ActivityLevel = SUPPORTED_ACTIVITY.includes(
    activity as ActivityLevel,
  )
    ? (activity as ActivityLevel)
    : "moderate";
  return {
    heightCm: height ? Number(height) : null,
    gender: normalizedGender,
    dateOfBirth: dob,
    activityLevel: normalizedActivity,
    goalWeightKg: goal ? Number(goal) : null,
    dailyCalorieTarget: target ? Number(target) : null,
  };
}

// --- rental settings ------------------------------------------------------
export async function getRentalSettings(): Promise<RentalSettings> {
  const raw = await getSetting(RENTAL_SETTINGS_KEY);
  if (!raw) return { ...DEFAULT_RENTAL_SETTINGS };
  try {
    const parsed = JSON.parse(raw) as Partial<RentalSettings>;
    return { ...DEFAULT_RENTAL_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_RENTAL_SETTINGS };
  }
}

export async function setRentalSettings(s: RentalSettings): Promise<void> {
  await setSetting(RENTAL_SETTINGS_KEY, JSON.stringify(s));
}

// --- tv sources -----------------------------------------------------------
function sanitizeTvSources(raw: unknown): TvSourcesState {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_TV_SOURCES_STATE };
  const obj = raw as Partial<TvSourcesState>;
  const custom: TvSource[] = Array.isArray(obj.custom)
    ? obj.custom.filter(
        (s): s is TvSource =>
          !!s &&
          typeof s === "object" &&
          typeof (s as TvSource).id === "string" &&
          (s as TvSource).id !== BUILTIN_IPTV_ORG_ID &&
          typeof (s as TvSource).name === "string" &&
          typeof (s as TvSource).url === "string",
      )
    : [];
  const validIds = new Set<string>([BUILTIN_IPTV_ORG_ID, ...custom.map((s) => s.id)]);
  const activeId =
    typeof obj.activeId === "string" && validIds.has(obj.activeId)
      ? obj.activeId
      : BUILTIN_IPTV_ORG_ID;
  return { custom, activeId };
}

export async function getTvSources(): Promise<TvSourcesState> {
  const raw = await getSetting(TV_SOURCES_KEY);
  if (!raw) return { ...DEFAULT_TV_SOURCES_STATE };
  try {
    return sanitizeTvSources(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_TV_SOURCES_STATE };
  }
}

export async function setTvSources(state: TvSourcesState): Promise<void> {
  await setSetting(TV_SOURCES_KEY, JSON.stringify(sanitizeTvSources(state)));
}

// --- manga sources --------------------------------------------------------
function sanitizeMangaSources(raw: unknown): MangaSourcesState {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_MANGA_SOURCES_STATE };
  const obj = raw as Partial<MangaSourcesState>;
  // Custom sources are user-added instances; only the generic `suwayomi`
  // kind is allowed here (built-ins are merged in by allSources()).
  const custom: MangaSource[] = Array.isArray(obj.custom)
    ? obj.custom.filter(
        (s): s is MangaSource =>
          !!s &&
          typeof s === "object" &&
          typeof (s as MangaSource).id === "string" &&
          !MANGA_BUILTIN_IDS.has((s as MangaSource).id) &&
          ((s as MangaSource).kind === "suwayomi" ||
            (s as MangaSource).kind === "extension") &&
          typeof (s as MangaSource).name === "string" &&
          typeof (s as MangaSource).url === "string",
      )
    : [];
  const validIds = new Set<string>([
    ...MANGA_BUILTIN_IDS,
    ...custom.map((s) => s.id),
  ]);
  const order: string[] = Array.isArray(obj.order)
    ? obj.order.filter((id) => typeof id === "string" && validIds.has(id))
    : [];
  for (const id of validIds) if (!order.includes(id)) order.push(id);
  const activeId =
    typeof obj.activeId === "string" && validIds.has(obj.activeId)
      ? obj.activeId
      : DEFAULT_MANGA_SOURCES_STATE.activeId;
  const disabledBuiltins = Array.isArray(obj.disabledBuiltins)
    ? obj.disabledBuiltins.filter(
        (id) => typeof id === "string" && MANGA_BUILTIN_IDS.has(id),
      )
    : [];
  return { custom, order, activeId, disabledBuiltins };
}

export async function getMangaSources(): Promise<MangaSourcesState> {
  const raw = await getSetting(MANGA_SOURCES_KEY);
  if (!raw) return { ...DEFAULT_MANGA_SOURCES_STATE };
  try {
    return sanitizeMangaSources(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_MANGA_SOURCES_STATE };
  }
}

export async function setMangaSources(state: MangaSourcesState): Promise<void> {
  await setSetting(MANGA_SOURCES_KEY, JSON.stringify(sanitizeMangaSources(state)));
}

// --- manga extension repos + installed extensions -------------------------
export async function getMangaRepos(): Promise<ExtRepo[]> {
  const raw = await getSetting(MANGA_REPOS_KEY);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr)
      ? arr.filter(
          (r) => r && typeof r.url === "string" && typeof r.name === "string",
        )
      : [];
  } catch {
    return [];
  }
}

export async function setMangaRepos(repos: ExtRepo[]): Promise<void> {
  await setSetting(MANGA_REPOS_KEY, JSON.stringify(repos));
}

export async function getInstalledExtensions(): Promise<InstalledExtension[]> {
  const raw = await getSetting(MANGA_EXTENSIONS_KEY);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr)
      ? arr.filter(
          (e) =>
            e &&
            typeof e.id === "string" &&
            typeof e.code === "string" &&
            typeof e.name === "string",
        )
      : [];
  } catch {
    return [];
  }
}

export async function setInstalledExtensions(
  list: InstalledExtension[],
): Promise<void> {
  await setSetting(MANGA_EXTENSIONS_KEY, JSON.stringify(list));
}

export async function setHealthProfile(p: HealthProfile): Promise<void> {
  await Promise.all([
    p.heightCm != null
      ? setSetting(HEALTH_HEIGHT_CM, String(p.heightCm))
      : deleteSetting(HEALTH_HEIGHT_CM),
    setSetting(HEALTH_GENDER, p.gender),
    p.dateOfBirth
      ? setSetting(HEALTH_DOB, p.dateOfBirth)
      : deleteSetting(HEALTH_DOB),
    setSetting(HEALTH_ACTIVITY, p.activityLevel),
    p.goalWeightKg != null
      ? setSetting(HEALTH_GOAL_WEIGHT_KG, String(p.goalWeightKg))
      : deleteSetting(HEALTH_GOAL_WEIGHT_KG),
    p.dailyCalorieTarget != null
      ? setSetting(HEALTH_DAILY_KCAL_TARGET, String(p.dailyCalorieTarget))
      : deleteSetting(HEALTH_DAILY_KCAL_TARGET),
  ]);
}
