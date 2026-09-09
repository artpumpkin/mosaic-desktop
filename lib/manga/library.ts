// Saved-series library + favorites for the Manga reader. localStorage, same
// shape as the movies favorites/recents store.

import { seriesKey, type MangaLibraryEntry } from "./types";

const LIBRARY_KEY = "mosaic.manga.library";
const FAVORITES_KEY = "mosaic.manga.favorites";

// --- Library (saved series) -----------------------------------------------

export function loadLibrary(): MangaLibraryEntry[] {
  try {
    const raw = localStorage.getItem(LIBRARY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr)
      ? arr.filter(
          (e) =>
            e &&
            typeof e.key === "string" &&
            typeof e.sourceId === "string" &&
            typeof e.mangaId === "string",
        )
      : [];
  } catch {
    return [];
  }
}

function writeLibrary(list: MangaLibraryEntry[]) {
  try {
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(list));
  } catch {
    /* quota */
  }
}

export function addToLibrary(e: MangaLibraryEntry) {
  const list = loadLibrary().filter((x) => x.key !== e.key);
  writeLibrary([e, ...list]);
}

export function removeFromLibrary(key: string) {
  writeLibrary(loadLibrary().filter((x) => x.key !== key));
}

export function isInLibrary(key: string): boolean {
  return loadLibrary().some((x) => x.key === key);
}

// --- Favorites -------------------------------------------------------------

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

export { seriesKey };
