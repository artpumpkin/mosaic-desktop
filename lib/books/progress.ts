// Reading progress, favorites, and recents for the Books section. localStorage,
// same rationale as lib/manga/progress.ts.

import type { BookReadProgress, BookRecent } from "./types";

const PROGRESS_KEY = "mosaic.books.progress";
const FAVORITES_KEY = "mosaic.books.favorites";
const RECENTS_KEY = "mosaic.books.recents";

type ProgressMap = Record<string, BookReadProgress>;

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

export function getBookProgress(key: string): BookReadProgress | null {
  return readProgress()[key] ?? null;
}

export function saveBookProgress(p: BookReadProgress) {
  const map = readProgress();
  map[p.key] = p;
  writeProgress(map);
}

export function clearBookProgress(key: string) {
  const map = readProgress();
  if (key in map) {
    delete map[key];
    writeProgress(map);
  }
}

export function clearAllProgress() {
  try {
    localStorage.removeItem(PROGRESS_KEY);
  } catch {
    /* ignore */
  }
}

export function listInProgress(): BookReadProgress[] {
  return Object.values(readProgress())
    .filter((p) => p.fraction < 0.98)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function progressCount(): number {
  return Object.keys(readProgress()).length;
}

export function throttledSaver(intervalMs: number) {
  let last = 0;
  return (p: BookReadProgress) => {
    const now = Date.now();
    if (now - last < intervalMs) return;
    last = now;
    saveBookProgress(p);
  };
}

// --- Favorites ------------------------------------------------------------

export function loadFavorites(): Set<string> {
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

export function saveFavorites(ids: Set<string>) {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify([...ids]));
  } catch {
    /* ignore */
  }
}

export function clearAllFavorites() {
  try {
    localStorage.removeItem(FAVORITES_KEY);
  } catch {
    /* ignore */
  }
}

export function favoritesCount(): number {
  return loadFavorites().size;
}

// --- Recents --------------------------------------------------------------

export function loadRecents(): BookRecent[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr)
      ? arr.filter((r) => r && typeof r.id === "string" && typeof r.at === "number")
      : [];
  } catch {
    return [];
  }
}

export function pushRecent(id: string) {
  const list = loadRecents().filter((r) => r.id !== id);
  list.unshift({ id, at: Date.now() });
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(list.slice(0, 48)));
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

export function recentsCount(): number {
  return loadRecents().length;
}

export function clearAllBookData() {
  clearAllProgress();
  clearAllFavorites();
  clearAllRecents();
}
