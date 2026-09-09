// Pluggable source system, modeled on the TV `kind`-dispatch
// (lib/tv/api.ts) but generalized to a registry so adding a source is purely
// additive: write a connector that implements MangaConnector, then register
// it (see lib/manga/connectors/index.ts). The UI never changes.

import type {
  Manga,
  MangaDetail,
  Chapter,
  ReaderPage,
  MangaSource,
} from "./types";
import type { BrowseSort } from "./genres";

export type SearchOpts = { limit?: number; offset?: number };

export type BrowseOpts = {
  sort?: BrowseSort;
  /** Source-specific genre/tag id (MangaDex tag UUID). */
  genre?: string | null;
};

export type SearchResult = {
  items: Manga[];
  /** Total available for the query, when the source reports it (load-more). */
  total?: number;
};

// Every source — built-in or user-added — implements this. Methods take the
// resolved MangaSource so a single connector instance can serve many source
// instances (e.g. several Suwayomi servers at different URLs).
export interface MangaConnector {
  readonly kind: string; // matches MangaSourceKind
  search(
    source: MangaSource,
    query: string,
    opts?: SearchOpts,
  ): Promise<SearchResult>;
  /** Optional curated rows for the browse screen (e.g. "Popular"). */
  browse?(
    source: MangaSource,
    opts?: BrowseOpts,
  ): Promise<{ title: string; items: Manga[] }[]>;
  getManga(source: MangaSource, mangaId: string): Promise<MangaDetail>;
  getChapters(source: MangaSource, mangaId: string): Promise<Chapter[]>;
  getPages(source: MangaSource, chapterId: string): Promise<ReaderPage[]>;
}

const REGISTRY = new Map<string, MangaConnector>();

export function registerConnector(c: MangaConnector) {
  REGISTRY.set(c.kind, c);
}

export function getConnectorFor(source: MangaSource): MangaConnector {
  const c = REGISTRY.get(source.kind);
  if (!c) throw new Error(`No connector registered for source "${source.kind}"`);
  return c;
}
