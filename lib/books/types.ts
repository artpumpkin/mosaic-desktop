// Domain types for the Books section. Open Library catalog ids use the
// `ol:OL123W` prefix; locally-scanned EPUBs use `local:<hash>`.

export type BookItem = {
  id: string;
  title: string;
  authors: string[];
  cover?: string | null;
  year?: string | null;
  genres?: string[];
  rating?: string | null;
  description?: string | null;
};

export type BookMeta = BookItem & {
  isbns?: string[];
  pageCount?: number | null;
  subjects?: string[];
  /** Absolute path when a local EPUB is linked to this catalog work. */
  localPath?: string | null;
  localId?: string | null;
};

export type LocalBookEntry = {
  id: string;
  path: string;
  title: string;
  authors: string[];
  cover?: string | null;
  isbns?: string[];
  workId?: string | null;
};

export type BookReadProgress = {
  key: string;
  title: string;
  cover?: string | null;
  path: string;
  locationCfi: string;
  fraction: number;
  updatedAt: number;
};

export type BookRecent = {
  id: string;
  at: number;
};

/** Map a BookItem onto the Movies CatalogItem shape for shared hero UI. */
export function bookToHeroItem(b: BookItem): import("@/lib/movies/types").CatalogItem {
  return {
    id: b.id,
    type: "movie",
    name: b.title,
    poster: b.cover ?? null,
    background: b.cover ?? null,
    imdbRating: b.rating ?? null,
    releaseInfo: b.year ?? null,
    genres: b.genres,
    description: b.description ?? null,
  };
}

export function parseWorkId(id: string): string | null {
  if (!id.startsWith("ol:")) return null;
  return id.slice(3);
}

export function workIdFromKey(key: string): string {
  const m = key.match(/OL\d+W/i);
  return m ? m[0].toUpperCase() : key.replace(/^\/works\//, "").replace(/^ol:/, "");
}
