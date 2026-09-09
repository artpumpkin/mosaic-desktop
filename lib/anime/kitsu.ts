// Anime catalog + metadata via the Kitsu API (https://kitsu.io/api/edge).
// We deliberately map Kitsu's JSON:API responses onto the SAME shapes the
// Movies section uses (CatalogItem / Meta / EpisodeMeta from lib/movies/types)
// so the entire downstream stack — PosterRail, TitleDetail, StreamPicker,
// MoviePlayer — is reused verbatim. Streaming is handled by Torrentio, which
// accepts Kitsu ids (`kitsu:<id>` / `kitsu:<id>:<ep>`); see app/anime/page.tsx.

import { fetchJsonCached } from "@/lib/movies/cache";
import type { CatalogItem, EpisodeMeta, Meta } from "@/lib/movies/types";

const BASE = "https://kitsu.io/api/edge";
const CATALOG_TTL_MS = 6 * 60 * 60 * 1000; // 6h
const META_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const EP_PAGE_LIMIT = 20; // Kitsu max page size (larger limits return empty)
const EP_MAX_PAGES = 150; // safety cap (~3000 eps) for very long runners
const EP_FETCH_CONCURRENCY = 8; // parallel episode-page requests

// Catalog rails shown on the Anime home, in order.
export const ANIME_CATALOGS: { id: string; name: string }[] = [
  { id: "trending", name: "Trending now" },
  { id: "popular", name: "Most popular" },
  { id: "top", name: "Top rated" },
  { id: "airing", name: "Currently airing" },
];

// Genre filter options. `slug` is Kitsu's category slug (used verbatim in
// `filter[categories]=`); `label` is the human title shown in the picker.
export const ANIME_GENRES: { slug: string; label: string }[] = [
  { slug: "action", label: "Action" },
  { slug: "adventure", label: "Adventure" },
  { slug: "comedy", label: "Comedy" },
  { slug: "drama", label: "Drama" },
  { slug: "fantasy", label: "Fantasy" },
  { slug: "horror", label: "Horror" },
  { slug: "mecha", label: "Mecha" },
  { slug: "music", label: "Music" },
  { slug: "mystery", label: "Mystery" },
  { slug: "psychological", label: "Psychological" },
  { slug: "romance", label: "Romance" },
  { slug: "sci-fi", label: "Sci-Fi" },
  { slug: "slice-of-life", label: "Slice of Life" },
  { slug: "sports", label: "Sports" },
  { slug: "supernatural", label: "Supernatural" },
  { slug: "thriller", label: "Thriller" },
];

// Sort orders offered in the browse toolbar. "featured" is the rails default
// (no browse). All others map to a Kitsu server-side sort param via
// `sortParam`, so pagination stays globally correct.
export type AnimeSort =
  | "featured"
  | "popular"
  | "top"
  | "newest"
  | "oldest"
  | "az"
  | "za";

export const ANIME_SORTS: { value: AnimeSort; label: string }[] = [
  { value: "featured", label: "Featured" },
  { value: "popular", label: "Most popular" },
  { value: "top", label: "Top rated" },
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "az", label: "A–Z" },
  { value: "za", label: "Z–A" },
];

// Kitsu JSON:API sort string for each option. `slug` is an alphabetical,
// title-derived key — a stable proxy for A–Z that sorts server-side (Kitsu has
// no reliable display-title sort). `featured` falls back to popularity.
export function sortParam(sort: AnimeSort): string {
  switch (sort) {
    case "top":
      return "-averageRating";
    case "newest":
      return "-startDate";
    case "oldest":
      return "startDate";
    case "az":
      return "slug";
    case "za":
      return "-slug";
    case "popular":
    case "featured":
    default:
      return "-userCount";
  }
}

export const BROWSE_PAGE_SIZE = 20;

// --- Kitsu response shapes (only the fields we read) ----------------------

type KitsuImage = {
  tiny?: string | null;
  small?: string | null;
  medium?: string | null;
  large?: string | null;
  original?: string | null;
};

type KitsuAnimeAttrs = {
  canonicalTitle?: string | null;
  titles?: Record<string, string | null>;
  synopsis?: string | null;
  posterImage?: KitsuImage | null;
  coverImage?: KitsuImage | null;
  averageRating?: string | null; // "0".."100"
  startDate?: string | null; // "YYYY-MM-DD"
  endDate?: string | null;
  subtype?: string | null; // TV | movie | OVA | ONA | special | music
  episodeCount?: number | null;
  episodeLength?: number | null; // minutes
  status?: string | null; // current | finished | tba | upcoming
};

type KitsuAnime = { id: string; attributes: KitsuAnimeAttrs };

type KitsuEpisodeAttrs = {
  number?: number | null;
  seasonNumber?: number | null;
  canonicalTitle?: string | null;
  titles?: Record<string, string | null>;
  synopsis?: string | null;
  thumbnail?: KitsuImage | null;
  airdate?: string | null;
};

type KitsuEpisode = { id: string; attributes: KitsuEpisodeAttrs };

type KitsuList<T> = { data?: T[]; meta?: { count?: number } };
type KitsuOne<T> = { data?: T };

// --- mappers --------------------------------------------------------------

function pickImage(img?: KitsuImage | null): string | null {
  if (!img) return null;
  return img.large ?? img.medium ?? img.original ?? img.small ?? null;
}

function title(attrs: KitsuAnimeAttrs): string {
  return (
    attrs.canonicalTitle ||
    attrs.titles?.en ||
    attrs.titles?.en_jp ||
    attrs.titles?.ja_jp ||
    "Untitled"
  );
}

function toContentType(subtype?: string | null): "movie" | "series" {
  return subtype === "movie" ? "movie" : "series";
}

function ratingOutOfTen(avg?: string | null): string | null {
  const n = avg ? Number(avg) : NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  return (n / 10).toFixed(1); // Kitsu is /100; TitleDetail renders "/10"
}

function toCatalogItem(a: KitsuAnime): CatalogItem {
  const at = a.attributes;
  return {
    id: a.id, // Kitsu numeric id (string); streamed as kitsu:<id>
    type: toContentType(at.subtype),
    name: title(at),
    poster: pickImage(at.posterImage),
    background: pickImage(at.coverImage),
    imdbRating: ratingOutOfTen(at.averageRating),
    releaseInfo: at.startDate?.slice(0, 4) ?? null,
    description: at.synopsis ?? null,
    runtime: at.episodeLength ? `${at.episodeLength}m` : null,
  };
}

function toEpisodeMeta(animeId: string, e: KitsuEpisode): EpisodeMeta | null {
  const num = e.attributes.number;
  if (typeof num !== "number" || num <= 0) return null;
  return {
    // All episodes live under a synthetic "season 1" — anime uses absolute
    // numbering, which is exactly what Torrentio's kitsu:<id>:<ep> wants.
    id: `${animeId}:1:${num}`,
    season: 1,
    episode: num,
    name: e.attributes.canonicalTitle || e.attributes.titles?.en || undefined,
    overview: e.attributes.synopsis ?? null,
    thumbnail: pickImage(e.attributes.thumbnail),
    released: e.attributes.airdate ?? null,
  };
}

// --- catalog --------------------------------------------------------------

// `sortOverride` lets the "See all" grid re-order a rail by the toolbar's Sort
// selector; when omitted each rail keeps its natural order.
function catalogUrl(catalogId: string, offset = 0, sortOverride?: AnimeSort): string {
  const pg = `page[limit]=${BROWSE_PAGE_SIZE}&page[offset]=${offset}`;
  const natural =
    catalogId === "top" ? "-averageRating" : "-userCount";
  const sort = sortOverride ? sortParam(sortOverride) : natural;
  switch (catalogId) {
    case "trending":
      // Kitsu's /trending endpoint is a fixed top-N list — it ignores offset.
      return `${BASE}/trending/anime?limit=${BROWSE_PAGE_SIZE}`;
    case "airing":
      return `${BASE}/anime?filter[status]=current&sort=${sort}&${pg}`;
    case "popular":
    case "top":
    default:
      return `${BASE}/anime?sort=${sort}&${pg}`;
  }
}

export async function fetchCatalog(catalogId: string): Promise<CatalogItem[]> {
  const json = await fetchJsonCached<KitsuList<KitsuAnime>>(
    catalogUrl(catalogId),
    CATALOG_TTL_MS,
  );
  return (json.data ?? []).map(toCatalogItem);
}

// A single page of a named catalog rail, for the "See all" grid. Returns the
// mapped items plus the RAW row count Kitsu returned — pagination/exhaustion is
// driven by the raw count so client-side filtering never short-circuits it.
// `trending` is a fixed list, so anything past page 0 reports empty.
export async function fetchCatalogPage(
  catalogId: string,
  offset: number,
  sortOverride?: AnimeSort,
): Promise<{ items: CatalogItem[]; raw: number }> {
  if (catalogId === "trending" && offset > 0) return { items: [], raw: 0 };
  const json = await fetchJsonCached<KitsuList<KitsuAnime>>(
    catalogUrl(catalogId, offset, sortOverride),
    CATALOG_TTL_MS,
  );
  const data = json.data ?? [];
  return { items: data.map(toCatalogItem), raw: data.length };
}

// --- browse (genre / sort filtered, paginated) ---------------------------

export type BrowseOpts = {
  genre?: string | null; // Kitsu category slug
  type?: "all" | "movie" | "series";
  sort?: AnimeSort;
  offset?: number;
  limit?: number;
};

function browseUrl({ genre, type, sort, offset = 0, limit = BROWSE_PAGE_SIZE }: BrowseOpts): string {
  const params = new URLSearchParams();
  if (genre) params.set("filter[categories]", genre);
  // Only "movie" is a single subtype; "series" is everything-else, so we let
  // Kitsu return all and drop movies client-side below.
  if (type === "movie") params.set("filter[subtype]", "movie");
  params.set("sort", sortParam(sort ?? "popular"));
  params.set("page[limit]", String(limit));
  params.set("page[offset]", String(offset));
  return `${BASE}/anime?${params.toString()}`;
}

// One page of the browse grid. Filters/sort live in `opts`; pagination via
// `offset`. Movies are dropped client-side when `type === "series"`, so we
// return the RAW Kitsu row count alongside the filtered items — the caller
// advances its offset and decides "is there more?" from `raw`, never from the
// (smaller) filtered length. Otherwise a page that filters down to <PAGE_SIZE
// would be mistaken for the last page and stop infinite scroll early.
export async function fetchBrowse(
  opts: BrowseOpts,
): Promise<{ items: CatalogItem[]; raw: number }> {
  const json = await fetchJsonCached<KitsuList<KitsuAnime>>(
    browseUrl(opts),
    CATALOG_TTL_MS,
  );
  const data = json.data ?? [];
  let items = data.map(toCatalogItem);
  if (opts.type === "series") items = items.filter((it) => it.type === "series");
  return { items, raw: data.length };
}

export async function searchCatalog(q: string): Promise<CatalogItem[]> {
  const url = `${BASE}/anime?filter[text]=${encodeURIComponent(q)}&page[limit]=20`;
  const json = await fetchJsonCached<KitsuList<KitsuAnime>>(url, CATALOG_TTL_MS);
  return (json.data ?? []).map(toCatalogItem);
}

export async function fetchMeta(id: string): Promise<Meta> {
  const detail = await fetchJsonCached<KitsuOne<KitsuAnime>>(
    `${BASE}/anime/${encodeURIComponent(id)}`,
    META_TTL_MS,
  );
  const a = detail.data;
  const base: Meta = a
    ? toCatalogItem(a)
    : { id, type: "series", name: "Untitled" };

  if (base.type === "movie") return base;

  const epUrl = (offset: number) =>
    `${BASE}/anime/${encodeURIComponent(
      id,
    )}/episodes?sort=number&page[limit]=${EP_PAGE_LIMIT}&page[offset]=${offset}`;

  // Fetch page 0 first — its `meta.count` tells us the total episode count, so
  // we can fan out the remaining pages in parallel instead of walking them one
  // at a time (One Piece alone is ~1400 episodes / 70 pages). Kitsu caps a page
  // at 20 rows regardless of the requested limit.
  const videos: EpisodeMeta[] = [];
  let first: KitsuList<KitsuEpisode>;
  try {
    first = await fetchJsonCached<KitsuList<KitsuEpisode>>(epUrl(0), META_TTL_MS);
  } catch {
    return { ...base, videos };
  }
  for (const e of first.data ?? []) {
    const ep = toEpisodeMeta(id, e);
    if (ep) videos.push(ep);
  }

  const total = first.meta?.count ?? (first.data?.length ?? 0);
  const totalPages = Math.min(Math.ceil(total / EP_PAGE_LIMIT), EP_MAX_PAGES);

  // Remaining page offsets (page 1 onward), fetched with a small concurrency
  // pool so we don't open ~70 sockets at once.
  const offsets: number[] = [];
  for (let p = 1; p < totalPages; p++) offsets.push(p * EP_PAGE_LIMIT);

  let cursor = 0;
  const worker = async () => {
    while (cursor < offsets.length) {
      const offset = offsets[cursor++];
      try {
        const json = await fetchJsonCached<KitsuList<KitsuEpisode>>(
          epUrl(offset),
          META_TTL_MS,
        );
        for (const e of json.data ?? []) {
          const ep = toEpisodeMeta(id, e);
          if (ep) videos.push(ep);
        }
      } catch {
        /* skip a failed page rather than aborting the whole list */
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(EP_FETCH_CONCURRENCY, offsets.length) }, worker),
  );

  // Parallel fetches complete out of order — sort back to absolute order.
  videos.sort((a, b) => a.episode - b.episode);

  return { ...base, videos };
}
