// Locally-persisted Anime UI preferences (browse filters). Validated on read so
// a stale/removed genre slug or a renamed sort can't wedge the page. Search text
// is intentionally NOT persisted — it's a transient query, not a preference.

import type { AnimeFilters } from "@/components/anime/AnimeToolbar";
import { ANIME_GENRES, ANIME_SORTS } from "@/lib/anime/kitsu";

const FILTERS_KEY = "mosaic.anime.filters";

export type PersistedAnimeFilters = Pick<AnimeFilters, "type" | "genre" | "sort">;

const VALID_TYPES = new Set<AnimeFilters["type"]>(["all", "movie", "series"]);
const VALID_GENRES = new Set(ANIME_GENRES.map((g) => g.slug));
const VALID_SORTS = new Set(ANIME_SORTS.map((s) => s.value));

export function loadAnimeFilters(): PersistedAnimeFilters | null {
  try {
    const raw = localStorage.getItem(FILTERS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<PersistedAnimeFilters>;
    if (!p || typeof p !== "object") return null;
    return {
      type: p.type && VALID_TYPES.has(p.type) ? p.type : "all",
      genre: typeof p.genre === "string" && VALID_GENRES.has(p.genre) ? p.genre : null,
      sort: p.sort && VALID_SORTS.has(p.sort) ? p.sort : "featured",
    };
  } catch {
    return null;
  }
}

export function saveAnimeFilters(f: PersistedAnimeFilters) {
  try {
    localStorage.setItem(FILTERS_KEY, JSON.stringify(f));
  } catch {
    /* quota / unavailable — preferences are best-effort */
  }
}
