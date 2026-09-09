// Generic watch-progress + favorites + recents store, parametrized by a
// localStorage key prefix. The Movies section has its own hand-written copy
// (lib/movies/progress.ts) predating this; new video sections (Anime, …) use
// this factory so they get the exact same behavior under their own namespace
// without forking the logic. Shape is the Movies WatchProgress — video
// sources share it.
//
// localStorage-backed: call only on the client.

import type { ContentType, WatchProgress } from "@/lib/movies/types";

export type RecentEntry = { id: string; type: ContentType; at: number };

// The subset MoviePlayer needs injected so a non-Movies section persists to
// its own store instead of the Movies one.
export type PlayerProgressStore = {
  getProgress: (id: string) => WatchProgress | null;
  saveProgress: (p: WatchProgress) => void;
  throttledSaver: (intervalMs: number) => (p: WatchProgress) => void;
  updateTrackPrefs: (
    id: string,
    prefs: Pick<
      WatchProgress,
      "audioLang" | "audioTitle" | "subKind" | "subLang" | "subId"
    >,
  ) => void;
};

export function createWatchProgressStore(prefix: string, recentsMax = 24) {
  const PROGRESS_KEY = `${prefix}.progress`;
  const FAVORITES_KEY = `${prefix}.favorites`;
  const RECENTS_KEY = `${prefix}.recents`;
  // Episodes/movies the user has *finished*. Progress entries are deleted once
  // playback reaches the end (see `saveProgress`), so without this separate
  // ledger a fully-watched episode would look identical to an unwatched one.
  const WATCHED_KEY = `${prefix}.watched`;

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
      /* quota */
    }
  }

  function getProgress(id: string): WatchProgress | null {
    return readProgress()[id] ?? null;
  }

  function saveProgress(p: WatchProgress) {
    if (!p.duration || p.duration < 60) return; // unreliable
    const map = readProgress();
    if (p.position >= p.duration - 60) {
      // Reached the end → record it as watched, then drop the resume entry.
      markWatched(p.id);
      delete map[p.id];
    } else {
      const prev = map[p.id];
      // Preserve remembered track prefs when this save doesn't carry them.
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

  function clearAllProgress() {
    writeProgress({});
  }

  function updateTrackPrefs(
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

  function clearProgress(id: string) {
    const map = readProgress();
    if (id in map) {
      delete map[id];
      writeProgress(map);
    }
  }

  function listInProgress(filterType?: ContentType): WatchProgress[] {
    const all = Object.values(readProgress());
    const filtered = filterType ? all.filter((p) => p.type === filterType) : all;
    return filtered.sort((a, b) => b.watchedAt - a.watchedAt);
  }

  function loadFavorites(): Set<string> {
    try {
      const raw = localStorage.getItem(FAVORITES_KEY);
      if (!raw) return new Set();
      const arr = JSON.parse(raw);
      return Array.isArray(arr)
        ? new Set(arr.filter((s) => typeof s === "string"))
        : new Set();
    } catch {
      return new Set();
    }
  }

  function saveFavorites(ids: Set<string>) {
    try {
      localStorage.setItem(FAVORITES_KEY, JSON.stringify([...ids]));
    } catch {
      /* ignore */
    }
  }

  function clearAllFavorites() {
    try {
      localStorage.removeItem(FAVORITES_KEY);
    } catch {
      /* ignore */
    }
  }

  function clearAllRecents() {
    try {
      localStorage.removeItem(RECENTS_KEY);
    } catch {
      /* ignore */
    }
  }

  function recentsCount(): number {
    return loadRecents().length;
  }

  function favoritesCount(): number {
    return loadFavorites().size;
  }

  // --- watched ledger (finished items) ---
  function loadWatched(): Set<string> {
    try {
      const raw = localStorage.getItem(WATCHED_KEY);
      if (!raw) return new Set();
      const arr = JSON.parse(raw);
      return Array.isArray(arr)
        ? new Set(arr.filter((s) => typeof s === "string"))
        : new Set();
    } catch {
      return new Set();
    }
  }

  function writeWatched(ids: Set<string>) {
    try {
      localStorage.setItem(WATCHED_KEY, JSON.stringify([...ids]));
    } catch {
      /* ignore */
    }
  }

  function markWatched(id: string) {
    const set = loadWatched();
    if (!set.has(id)) {
      set.add(id);
      writeWatched(set);
    }
  }

  function unmarkWatched(id: string) {
    const set = loadWatched();
    if (set.delete(id)) writeWatched(set);
  }

  function isWatched(id: string): boolean {
    return loadWatched().has(id);
  }

  function clearAllWatched() {
    try {
      localStorage.removeItem(WATCHED_KEY);
    } catch {
      /* ignore */
    }
  }

  function watchedCount(): number {
    return loadWatched().size;
  }

  function loadRecents(): RecentEntry[] {
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

  function pushRecent(id: string, type: ContentType) {
    const existing = loadRecents().filter((e) => e.id !== id);
    const next: RecentEntry[] = [{ id, type, at: Date.now() }, ...existing].slice(
      0,
      recentsMax,
    );
    try {
      localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }

  function throttledSaver(intervalMs: number) {
    let last = 0;
    return (p: WatchProgress) => {
      const now = Date.now();
      if (now - last < intervalMs) return;
      last = now;
      saveProgress(p);
    };
  }

  function progressCount(): number {
    return Object.keys(readProgress()).length;
  }

  return {
    getProgress,
    saveProgress,
    clearAllProgress,
    updateTrackPrefs,
    clearProgress,
    listInProgress,
    loadFavorites,
    saveFavorites,
    clearAllFavorites,
    loadRecents,
    pushRecent,
    clearAllRecents,
    throttledSaver,
    progressCount,
    recentsCount,
    favoritesCount,
    loadWatched,
    markWatched,
    unmarkWatched,
    isWatched,
    clearAllWatched,
    watchedCount,
  };
}
