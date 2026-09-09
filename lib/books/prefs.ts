// Locally-persisted Books UI preferences (browse filters). Search is transient.

import type { BookFilters } from "@/components/books/BookToolbar";
import { BOOK_GENRES, BOOK_SORTS } from "@/lib/books/openlibrary";

const FILTERS_KEY = "mosaic.books.filters";

export type PersistedBookFilters = Pick<BookFilters, "genre" | "sort">;

const VALID_GENRES = new Set(BOOK_GENRES.map((g) => g.slug));
const VALID_SORTS = new Set(BOOK_SORTS.map((s) => s.value));

export function loadBookFilters(): PersistedBookFilters | null {
  try {
    const raw = localStorage.getItem(FILTERS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<PersistedBookFilters>;
    if (!p || typeof p !== "object") return null;
    return {
      genre: typeof p.genre === "string" && VALID_GENRES.has(p.genre) ? p.genre : null,
      sort: p.sort && VALID_SORTS.has(p.sort) ? p.sort : "featured",
    };
  } catch {
    return null;
  }
}

export function saveBookFilters(f: PersistedBookFilters) {
  try {
    localStorage.setItem(FILTERS_KEY, JSON.stringify(f));
  } catch {
    /* best-effort */
  }
}
