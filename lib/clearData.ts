// Aggregated "clear stored data" helpers for the Manage-data settings UI.
//
// Each media section owns its own storage. This module just calls the Movies
// section's clear functions and wipes the TV localStorage keys directly — TV's
// storage module (lib/tv/storage.ts) is being built in parallel, so we address
// its keys by literal here rather than editing that file. Manga is likewise
// owned by its own (in-progress) section and intentionally not touched.

import {
  clearAllProgress,
  clearAllFavorites,
  clearAllRecents,
  clearProgress,
  progressCount,
} from "@/lib/movies/progress";
import { clearAllTvCache } from "@/lib/tv/api";

const TV_RECENTS_KEY = "mosaic.tv.recent";

// Mirror of the keys in lib/tv/storage.ts + app/tv/page.tsx (kept as literals
// to avoid importing those co-edited files).
const TV_KEYS = ["mosaic.tv.recent", "mosaic.tv.favorites", "mosaic.tv.navScope"];

function rmKeys(keys: string[]) {
  for (const k of keys) {
    try {
      localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  }
}

export function moviesContinueCount(): number {
  try {
    return progressCount();
  } catch {
    return 0;
  }
}

export function clearMoviesContinueWatching() {
  clearAllProgress();
}

export function clearMoviesFavorites() {
  clearAllFavorites();
}

export function clearMoviesRecents() {
  clearAllRecents();
}

export function clearTvFavoritesAndRecents() {
  rmKeys(TV_KEYS);
}

export async function clearTvListCache() {
  await clearAllTvCache();
}

/** Remove a single Continue-watching entry by its aggregate key (the `key`
 *  field from lib/continue/aggregate.ts: "movie:ID" for movies & series,
 *  "tv:ID" for channels). Drives the per-card "×" on the dashboard rail.
 *  Manga is owned by its own section. */
export function removeContinueItem(key: string) {
  const idx = key.indexOf(":");
  if (idx === -1) return;
  const kind = key.slice(0, idx);
  const id = key.slice(idx + 1);
  if (kind === "movie" || kind === "series") {
    clearProgress(id);
  } else if (kind === "tv") {
    try {
      const raw = localStorage.getItem(TV_RECENTS_KEY);
      if (!raw) return;
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return;
      const next = arr.filter(
        (e) => (typeof e === "string" ? e : e?.id) !== id,
      );
      localStorage.setItem(TV_RECENTS_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }
}

/** Nuke everything Movies + TV: continue-watching, favorites, recents, and the
 *  cached channel lists. (Manga is owned by its own section.) */
export async function clearAllMediaData() {
  clearAllProgress();
  clearAllFavorites();
  clearAllRecents();
  rmKeys(TV_KEYS);
  await clearAllTvCache();
}
