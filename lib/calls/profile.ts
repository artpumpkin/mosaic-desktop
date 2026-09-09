"use client";

export type Profile = {
  name: string;
  color: string;
};

export const PROFILE_COLORS = [
  "#a78bfa", // violet
  "#f472b6", // pink
  "#34d399", // emerald
  "#fbbf24", // amber
  "#60a5fa", // blue
  "#f87171", // red
  "#fb923c", // orange
  "#22d3ee", // cyan
  "#c084fc", // purple
  "#a3e635", // lime
] as const;

const STORAGE_KEY = "mosaic.calls.profile";

function randomColor(): string {
  return PROFILE_COLORS[Math.floor(Math.random() * PROFILE_COLORS.length)];
}

export const DEFAULT_PROFILE: Profile = {
  name: "",
  color: PROFILE_COLORS[0],
};

export function loadProfile(): Profile {
  if (typeof window === "undefined") return DEFAULT_PROFILE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      // First time: pick a random color so two new users likely don't collide.
      return { ...DEFAULT_PROFILE, color: randomColor() };
    }
    const parsed = JSON.parse(raw) as Partial<Profile>;
    return {
      name: typeof parsed.name === "string" ? parsed.name : "",
      color: typeof parsed.color === "string" ? parsed.color : PROFILE_COLORS[0],
    };
  } catch {
    return DEFAULT_PROFILE;
  }
}

export function saveProfile(profile: Profile): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // ignore
  }
}

/** Display name fallback when the peer hasn't sent a profile yet. */
export function displayName(p: Profile | null, fallback = "Peer"): string {
  if (!p) return fallback;
  const trimmed = p.name.trim();
  return trimmed || fallback;
}
