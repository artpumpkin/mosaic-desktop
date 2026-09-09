// Cinemeta is Stremio's free metadata addon. No API key, IMDb-keyed,
// matches Torrentio's id format. We use three endpoints:
//   GET /catalog/{type}/{catalogId}.json
//   GET /catalog/{type}/{catalogId}/genre={g}.json (or /search={q}.json)
//   GET /meta/{type}/{imdbId}.json
//
// Catalog responses: { metas: CatalogItem[] }
// Meta responses:    { meta: Meta }

import { fetchJsonCached } from "./cache";
import type { CatalogItem, ContentType, Meta } from "./types";

const BASE = "https://v3-cinemeta.strem.io";

const CATALOG_TTL_MS = 6 * 60 * 60 * 1000; // 6h — catalogs do shift
const META_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7d — title metadata is stable
const SEARCH_TTL_MS = 60 * 60 * 1000; // 1h — search-by-query

// Stremio's manifest defines a fixed set of "top" catalogs plus the user's
// custom installed ones. For our purposes the built-ins below cover the
// Stremio Discover defaults.
export const CINEMETA_CATALOGS: { id: string; name: string }[] = [
  { id: "top", name: "Popular" },
  { id: "year", name: "By year" },
  { id: "imdbRating", name: "Top rated" },
];

// Cinemeta exposes genres via filter param. The list below is hand-picked
// from Cinemeta's manifest (https://v3-cinemeta.strem.io/manifest.json).
export const CINEMETA_GENRES = [
  "Action",
  "Adventure",
  "Animation",
  "Comedy",
  "Crime",
  "Documentary",
  "Drama",
  "Family",
  "Fantasy",
  "History",
  "Horror",
  "Music",
  "Mystery",
  "Romance",
  "Sci-Fi",
  "Thriller",
  "War",
  "Western",
];

// Subset rendered as home genre rails. The full CINEMETA_GENRES list stays
// available in the filter dropdown, but the resting home view only fetches +
// paints these 6 to keep the DOM light (18 rails × ~100 posters was janky).
export const HOME_GENRES = [
  "Action",
  "Comedy",
  "Drama",
  "Sci-Fi",
  "Horror",
  "Animation",
] as const;

export type CatalogFetch = {
  type: ContentType;
  catalogId: string; // "top" | "year" | "imdbRating"
  genre?: string | null;
  skip?: number;
};

export async function fetchCatalog(opts: CatalogFetch): Promise<CatalogItem[]> {
  const { type, catalogId, genre, skip } = opts;
  const segments: string[] = [];
  if (genre) segments.push(`genre=${encodeURIComponent(genre)}`);
  if (skip && skip > 0) segments.push(`skip=${skip}`);
  const suffix = segments.length ? "/" + segments.join("&") : "";
  const url = `${BASE}/catalog/${type}/${catalogId}${suffix}.json`;
  const json = await fetchJsonCached<{ metas?: CatalogItem[] }>(
    url,
    CATALOG_TTL_MS,
  );
  return (json.metas ?? []).map((m) => ({ ...m, type }));
}

// Cinemeta paginates catalogs in chunks of ~100 (`skip` param). To make the
// initial Movies/Series view feel populated we fan out and load several pages
// in parallel, then concatenate while preserving order. Dedup by id since
// some pages overlap across "skip" steps on edge catalogs.
export const CATALOG_PAGE_SIZE = 100;

export async function fetchCatalogPages(
  opts: Omit<CatalogFetch, "skip">,
  pages: number,
): Promise<CatalogItem[]> {
  const skips = Array.from({ length: pages }, (_, i) => i * CATALOG_PAGE_SIZE);
  const results = await Promise.allSettled(
    skips.map((skip) => fetchCatalog({ ...opts, skip })),
  );
  const seen = new Set<string>();
  const out: CatalogItem[] = [];
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    for (const item of r.value) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
    }
  }
  return out;
}

export async function searchCatalog(
  type: ContentType,
  query: string,
): Promise<CatalogItem[]> {
  const q = query.trim();
  if (!q) return [];
  const url = `${BASE}/catalog/${type}/top/search=${encodeURIComponent(q)}.json`;
  const json = await fetchJsonCached<{ metas?: CatalogItem[] }>(url, SEARCH_TTL_MS);
  return (json.metas ?? []).map((m) => ({ ...m, type }));
}

export async function fetchMeta(
  type: ContentType,
  imdbId: string,
): Promise<Meta | null> {
  const url = `${BASE}/meta/${type}/${imdbId}.json`;
  try {
    const json = await fetchJsonCached<{ meta?: Meta }>(url, META_TTL_MS);
    if (!json.meta) return null;
    return { ...json.meta, type };
  } catch {
    return null;
  }
}
