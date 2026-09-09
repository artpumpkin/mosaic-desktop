// Watch-progress + favorites + recent-titles persistence for the Movies
// section. Stored in localStorage because the volumes are tiny (a few KB
// even for power users) and we want zero round-trips during playback.

import type { ContentType, WatchProgress } from "./types";

const PROGRESS_KEY = "mosaic.movies.progress";
const FAVORITES_KEY = "mosaic.movies.favorites";
const RECENTS_KEY = "mosaic.movies.recents";
const RECENTS_MAX = 24;

// --- Progress -------------------------------------------------------------

type ProgressMap = Record<string, WatchProgress>;

function readProgress(): ProgressMap {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as ProgressMap) : {};
  } catch {
    return {};
  }
}

function writeProgress(map: ProgressMap) {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(map));
  } catch {
    /* quota — drop oldest if it happens */
  }
}

export function getProgress(id: string): WatchProgress | null {
  return readProgress()[id] ?? null;
}

export function saveProgress(p: WatchProgress) {
  if (!p.duration || p.duration < 60) return; // unreliable
  // Consider "watched to the end" if within 60s of duration; clear instead
  // of storing a useless entry that would show as already-watched.
  const map = readProgress();
  if (p.position >= p.duration - 60) {
    delete map[p.id];
  } else {
    const prev = map[p.id];
    // Preserve remembered audio/subtitle prefs when THIS save doesn't carry
    // them (e.g. a position tick that fired before the track list was known).
    // An explicit value — including subKind:"off" — always wins.
    map[p.id] = {
      ...p,
      audioLang: p.audioLang ?? prev?.audioLang ?? null,
      audioTitle: p.audioTitle ?? prev?.audioTitle ?? null,
      subKind: p.subKind ?? prev?.subKind ?? null,
      subLang: p.subLang ?? prev?.subLang ?? null,
      subId: p.subId ?? prev?.subId ?? null,
    };
  }
  writeProgress(map);
}

/** Wipe ALL continue-watching entries. */
export function clearAllProgress() {
  writeProgress({});
}

/** Merge remembered track prefs into an existing progress entry. No-op when
 *  the title has no entry yet — the next progress tick persists them. */
export function updateTrackPrefs(
  id: string,
  prefs: Pick<
    WatchProgress,
    "audioLang" | "audioTitle" | "subKind" | "subLang" | "subId"
  >,
) {
  const map = readProgress();
  const prev = map[id];
  if (!prev) return;
  map[id] = { ...prev, ...prefs };
  writeProgress(map);
}

export function clearProgress(id: string) {
  const map = readProgress();
  if (id in map) {
    delete map[id];
    writeProgress(map);
  }
}

export function listInProgress(filterType?: ContentType): WatchProgress[] {
  const all = Object.values(readProgress());
  const filtered = filterType ? all.filter((p) => p.type === filterType) : all;
  return filtered.sort((a, b) => b.watchedAt - a.watchedAt);
}

// --- Favorites ------------------------------------------------------------

export function loadFavorites(): Set<string> {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr.filter((s) => typeof s === "string")) : new Set();
  } catch {
    return new Set();
  }
}

export function saveFavorites(ids: Set<string>) {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify([...ids]));
  } catch {
    /* ignore */
  }
}

// --- Recents (last picked titles) -----------------------------------------

type RecentEntry = { id: string; type: ContentType; at: number };

export function loadRecents(): RecentEntry[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr)
      ? arr.filter(
          (e) =>
            e &&
            typeof e.id === "string" &&
            (e.type === "movie" || e.type === "series") &&
            typeof e.at === "number",
        )
      : [];
  } catch {
    return [];
  }
}

export function pushRecent(id: string, type: ContentType) {
  const existing = loadRecents().filter((e) => e.id !== id);
  const next: RecentEntry[] = [{ id, type, at: Date.now() }, ...existing].slice(
    0,
    RECENTS_MAX,
  );
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

// Throttle helper used by the player to limit timeupdate writes.
export function throttledSaver(intervalMs: number) {
  let last = 0;
  return (p: WatchProgress) => {
    const now = Date.now();
    if (now - last < intervalMs) return;
    last = now;
    saveProgress(p);
  };
}

// --- Bulk clear (Manage data UI) ------------------------------------------

export function clearAllFavorites() {
  try {
    localStorage.removeItem(FAVORITES_KEY);
  } catch {
    /* ignore */
  }
}

export function clearAllRecents() {
  try {
    localStorage.removeItem(RECENTS_KEY);
  } catch {
    /* ignore */
  }
}

/** Count of stored continue-watching entries — for the Manage data UI. */
export function progressCount(): number {
  return Object.keys(readProgress()).length;
}
