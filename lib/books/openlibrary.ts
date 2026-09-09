// Book catalog + metadata via the Open Library API (https://openlibrary.org).
// Mirrors lib/anime/kitsu.ts: rails, browse, search, detail — mapped onto
// BookItem / BookMeta from lib/books/types.ts.

import { fetchJsonCached } from "@/lib/movies/cache";
import type { BookItem, BookMeta } from "./types";
import { workIdFromKey } from "./types";

const BASE = "https://openlibrary.org";
const CATALOG_TTL_MS = 6 * 60 * 60 * 1000;
const META_TTL_MS = 24 * 60 * 60 * 1000;

export const BOOK_CATALOGS: { id: string; name: string; subject?: string }[] = [
  { id: "trending", name: "Trending now" },
  { id: "popular", name: "Most popular", subject: "fiction" },
  { id: "fiction", name: "Fiction", subject: "fiction" },
  { id: "fantasy", name: "Fantasy", subject: "fantasy" },
  { id: "mystery", name: "Mystery", subject: "mystery" },
  { id: "romance", name: "Romance", subject: "romance" },
  { id: "sci-fi", name: "Sci-Fi", subject: "science_fiction" },
  { id: "biography", name: "Biography", subject: "biography" },
];

export const BOOK_GENRES: { slug: string; label: string }[] = [
  { slug: "fiction", label: "Fiction" },
  { slug: "fantasy", label: "Fantasy" },
  { slug: "science_fiction", label: "Science Fiction" },
  { slug: "mystery", label: "Mystery" },
  { slug: "romance", label: "Romance" },
  { slug: "thriller", label: "Thriller" },
  { slug: "horror", label: "Horror" },
  { slug: "history", label: "History" },
  { slug: "biography", label: "Biography" },
  { slug: "poetry", label: "Poetry" },
  { slug: "children", label: "Children" },
  { slug: "young_adult", label: "Young Adult" },
];

export type BookSort =
  | "featured"
  | "popular"
  | "top"
  | "newest"
  | "oldest"
  | "az"
  | "za";

export const BOOK_SORTS: { value: BookSort; label: string }[] = [
  { value: "featured", label: "Featured" },
  { value: "popular", label: "Most popular" },
  { value: "top", label: "Top rated" },
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "az", label: "A–Z" },
  { value: "za", label: "Z–A" },
];

// Open Library's search `sort` accepts a fixed vocabulary — `editions`,
// `rating`, `new`, `old`, `title` (all single-token; "editions desc" / "title
// asc" are NOT valid and silently return nothing). There's no descending-title
// sort, so Z–A falls back to title order.
export function sortParam(sort: BookSort): string {
  switch (sort) {
    case "top":
      return "rating";
    case "newest":
      return "new";
    case "oldest":
      return "old";
    case "az":
    case "za":
      return "title";
    case "popular":
    case "featured":
    default:
      return "editions";
  }
}

export const BROWSE_PAGE_SIZE = 20;

// --- Open Library response shapes (subset) --------------------------------

// The /subjects endpoint returns authors as { name, key } objects, while
// /search.json returns plain author_name strings — accept both.
type OlAuthor = string | { name?: string; key?: string };

type OlDoc = {
  key?: string;
  title?: string;
  author_name?: string[];
  authors?: OlAuthor[];
  cover_i?: number;
  cover_id?: number;
  first_publish_year?: number;
  subject?: string[];
  ratings_average?: number;
  ratings_count?: number;
  edition_count?: number;
};

type OlSearchResponse = { numFound?: number; docs?: OlDoc[] };
type OlSubjectResponse = { name?: string; work_count?: number; works?: OlDoc[] };
// Trending uses the search-doc shape (`cover_i`), unlike /subjects (`cover_id`).
type OlTrendingResponse = { works?: { key?: string; title?: string; author_name?: string[]; cover_i?: number; cover_id?: number; first_publish_year?: number }[] };

type OlWork = {
  key?: string;
  title?: string;
  description?: string | { value?: string };
  covers?: number[];
  subjects?: string[];
  authors?: { author?: { key?: string } }[];
  first_publish_date?: string;
  number_of_pages?: number;
};

type OlEdition = {
  isbn_10?: string[];
  isbn_13?: string[];
};

type OlEditionsResponse = { entries?: OlEdition[] };

// --- mappers --------------------------------------------------------------

// Normalize author entries (strings from search, { name } objects from
// subjects) into a plain string[] — otherwise objects render as "[object Object]".
function normAuthors(arr?: OlAuthor[]): string[] {
  if (!arr) return [];
  return arr
    .map((a) => (typeof a === "string" ? a : a?.name ?? ""))
    .filter((s): s is string => !!s);
}

export function coverUrl(coverId?: number | null): string | null {
  if (!coverId) return null;
  return `https://covers.openlibrary.org/b/id/${coverId}-L.jpg`;
}

function docToBookItem(doc: OlDoc): BookItem | null {
  const key = doc.key;
  if (!key) return null;
  const workId = workIdFromKey(key);
  const rating =
    doc.ratings_average && doc.ratings_count && doc.ratings_count > 0
      ? doc.ratings_average.toFixed(1)
      : null;
  return {
    id: `ol:${workId}`,
    title: doc.title ?? "Untitled",
    authors: doc.author_name ?? normAuthors(doc.authors),
    cover: coverUrl(doc.cover_i ?? doc.cover_id),
    year: doc.first_publish_year ? String(doc.first_publish_year) : null,
    genres: doc.subject?.slice(0, 4),
    rating,
    description: null,
  };
}

function trendingToBookItem(
  w: NonNullable<OlTrendingResponse["works"]>[number],
): BookItem | null {
  if (!w.key) return null;
  const workId = workIdFromKey(w.key);
  return {
    id: `ol:${workId}`,
    title: w.title ?? "Untitled",
    authors: w.author_name ?? [],
    cover: coverUrl(w.cover_i ?? w.cover_id),
    year: w.first_publish_year ? String(w.first_publish_year) : null,
  };
}

function descriptionText(desc?: OlWork["description"]): string | null {
  if (!desc) return null;
  if (typeof desc === "string") return desc;
  return desc.value ?? null;
}

// --- catalog --------------------------------------------------------------

function catalogUrl(catalogId: string, offset = 0, sortOverride?: BookSort): string {
  const cat = BOOK_CATALOGS.find((c) => c.id === catalogId);
  if (catalogId === "trending") {
    return `${BASE}/trending/daily.json`;
  }
  const subject = cat?.subject ?? "fiction";
  const limit = BROWSE_PAGE_SIZE;
  // The /subjects endpoint can't sort, so when a non-featured sort is active
  // route through /search.json (which honours `sort`) filtered to the catalog's
  // subject. Without a sort we keep the cheaper /subjects feed.
  if (sortOverride && sortOverride !== "featured") {
    return browseUrl({ genre: subject, sort: sortOverride, offset, limit });
  }
  return `${BASE}/subjects/${subject}.json?limit=${limit}&offset=${offset}`;
}

export async function fetchCatalog(catalogId: string): Promise<BookItem[]> {
  if (catalogId === "trending") {
    const json = await fetchJsonCached<OlTrendingResponse>(
      catalogUrl(catalogId),
      CATALOG_TTL_MS,
    );
    return (json.works ?? [])
      .map(trendingToBookItem)
      .filter((x): x is BookItem => x != null);
  }
  const json = await fetchJsonCached<OlSubjectResponse>(
    catalogUrl(catalogId),
    CATALOG_TTL_MS,
  );
  return (json.works ?? [])
    .map(docToBookItem)
    .filter((x): x is BookItem => x != null);
}

export async function fetchCatalogPage(
  catalogId: string,
  offset: number,
  sortOverride?: BookSort,
): Promise<{ items: BookItem[]; raw: number }> {
  if (catalogId === "trending" && offset > 0) return { items: [], raw: 0 };
  if (catalogId === "trending") {
    const items = await fetchCatalog(catalogId);
    return { items, raw: items.length };
  }
  // catalogUrl routes to /search.json (docs) when a sort is active, otherwise
  // /subjects (works) — accept whichever array the response carries.
  const json = await fetchJsonCached<OlSubjectResponse & OlSearchResponse>(
    catalogUrl(catalogId, offset, sortOverride),
    CATALOG_TTL_MS,
  );
  const data = json.works ?? json.docs ?? [];
  return {
    items: data.map(docToBookItem).filter((x): x is BookItem => x != null),
    raw: data.length,
  };
}

// --- browse / search ------------------------------------------------------

export type BrowseOpts = {
  genre?: string | null;
  sort?: BookSort;
  offset?: number;
  limit?: number;
};

function browseUrl({ genre, sort, offset = 0, limit = BROWSE_PAGE_SIZE }: BrowseOpts): string {
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  params.set("offset", String(offset));
  params.set("sort", sortParam(sort ?? "popular"));
  // `subject=` filters without needing a text query; `q=*` is NOT a valid
  // Open Library query and returns zero results, which is why the genre
  // filters showed "0 books". With no genre we browse the fiction subject.
  params.set("subject", genre || "fiction");
  return `${BASE}/search.json?${params.toString()}`;
}

export async function fetchBrowse(
  opts: BrowseOpts,
): Promise<{ items: BookItem[]; raw: number }> {
  const json = await fetchJsonCached<OlSearchResponse>(browseUrl(opts), CATALOG_TTL_MS);
  const data = json.docs ?? [];
  return {
    items: data.map(docToBookItem).filter((x): x is BookItem => x != null),
    raw: data.length,
  };
}

export async function searchCatalog(q: string): Promise<BookItem[]> {
  const url = `${BASE}/search.json?q=${encodeURIComponent(q)}&limit=20`;
  const json = await fetchJsonCached<OlSearchResponse>(url, CATALOG_TTL_MS);
  return (json.docs ?? [])
    .map(docToBookItem)
    .filter((x): x is BookItem => x != null);
}

export async function fetchMeta(id: string): Promise<BookMeta> {
  const workId = id.startsWith("ol:") ? id.slice(3) : workIdFromKey(id);
  const work = await fetchJsonCached<OlWork>(
    `${BASE}/works/${encodeURIComponent(workId)}.json`,
    META_TTL_MS,
  );

  let isbns: string[] = [];
  try {
    const eds = await fetchJsonCached<OlEditionsResponse>(
      `${BASE}/works/${encodeURIComponent(workId)}/editions.json?limit=10`,
      META_TTL_MS,
    );
    for (const e of eds.entries ?? []) {
      if (e.isbn_13) isbns.push(...e.isbn_13);
      if (e.isbn_10) isbns.push(...e.isbn_10);
    }
    isbns = [...new Set(isbns)];
  } catch {
    /* editions optional */
  }

  const coverId = work.covers?.[0];
  return {
    id: `ol:${workId}`,
    title: work.title ?? "Untitled",
    authors: [],
    cover: coverUrl(coverId),
    year: work.first_publish_date?.slice(0, 4) ?? null,
    genres: work.subjects?.slice(0, 6),
    rating: null,
    description: descriptionText(work.description),
    isbns,
    pageCount: work.number_of_pages ?? null,
    subjects: work.subjects,
  };
}

/** Client-side sort for search results (small sets). */
export function sortBookItems(items: BookItem[], sort: BookSort): BookItem[] {
  const arr = [...items];
  switch (sort) {
    case "top":
      return arr.sort(
        (a, b) => (parseFloat(b.rating ?? "0") || 0) - (parseFloat(a.rating ?? "0") || 0),
      );
    case "newest":
      return arr.sort((a, b) => (parseInt(b.year ?? "0", 10) || 0) - (parseInt(a.year ?? "0", 10) || 0));
    case "oldest":
      return arr.sort((a, b) => (parseInt(a.year ?? "0", 10) || 0) - (parseInt(b.year ?? "0", 10) || 0));
    case "az":
      return arr.sort((a, b) => a.title.localeCompare(b.title));
    case "za":
      return arr.sort((a, b) => b.title.localeCompare(a.title));
    default:
      return items;
  }
}
