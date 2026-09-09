// Domain + source types for the Manga reader. Mirrors the shape of the
// TV/Movies domains (lib/tv/sources.ts, lib/movies/types.ts): permissive
// optional fields, every catalog item namespaced by its `sourceId` so two
// sources returning "One Piece" never collide in local storage.

// --- Sources --------------------------------------------------------------

export type MangaSourceKind = "mangadex" | "comick" | "suwayomi" | "extension";

export type MangaSource = {
  id: string; // built-in kinds use a stable id == kind; custom use a uuid
  kind: MangaSourceKind;
  name: string;
  url: string; // "" for built-ins; base URL for suwayomi instances
  enabled: boolean;
};

export type MangaSourcesState = {
  // Built-ins are merged in by allSources(); `custom` holds user-added
  // instances (currently only the `suwayomi` kind).
  custom: MangaSource[];
  // Search/browse priority — array of source ids, highest first.
  order: string[];
  // Currently-focused source for the browse screen.
  activeId: string;
  // Per-source disabled flags for built-ins (custom carry their own `enabled`).
  disabledBuiltins: string[];
};

// --- Catalog --------------------------------------------------------------

export type MangaStatus =
  | "ongoing"
  | "completed"
  | "hiatus"
  | "cancelled"
  | "unknown";

export type Manga = {
  sourceId: string; // which source this came from
  id: string; // source-local manga id
  title: string;
  cover?: string | null; // absolute thumbnail URL (loads via <img>)
  year?: number | null;
  status?: MangaStatus;
};

export type MangaDetail = Manga & {
  description?: string | null;
  tags?: string[];
  authors?: string[];
  altTitles?: string[];
  contentRating?: string | null;
};

// --- Chapters / pages -----------------------------------------------------

export type Chapter = {
  id: string; // source-local chapter id
  number: string | null; // "1", "1054", "10.5"; null for oneshots
  volume?: string | null;
  title?: string | null;
  lang: string; // "en"
  pages?: number | null; // page count when known
  scanlator?: string | null;
  publishedAt?: string | null; // ISO
};

export type ReaderPage = {
  index: number; // 0-based
  url: string; // full-quality absolute URL
  urlDataSaver?: string | null; // optional low-bandwidth variant
};

// --- Local persistence ----------------------------------------------------

// Reading position is per (sourceId, mangaId). `key` is `${sourceId}:${mangaId}`.
export type MangaReadProgress = {
  key: string;
  sourceId: string;
  mangaId: string;
  chapterId: string;
  // Numeric chapter reached (for the "Continue" label + the progress bar).
  chapterNumber: string | null;
  pageIndex: number; // last page seen within chapterId
  pageCount: number; // pages in that chapter
  updatedAt: number; // epoch ms
  title: string; // denormalized for the "Continue reading" rail
  cover?: string | null;
};

export type MangaLibraryEntry = {
  key: string; // `${sourceId}:${mangaId}`
  sourceId: string;
  mangaId: string;
  title: string;
  cover?: string | null;
  addedAt: number;
};

// Helper: the localStorage/library key for a series.
export function seriesKey(sourceId: string, mangaId: string): string {
  return `${sourceId}:${mangaId}`;
}

// --- Extensions (Mihon-style installable sources) -------------------------

// A repository the user has added. Its index lists installable extensions.
export type ExtRepo = { url: string; name: string };

// An extension manifest as listed in a repo index (or the built-in catalog).
export type RepoExtensionManifest = {
  id: string;
  name: string;
  lang?: string;
  version?: number;
  nsfw?: boolean;
  /** Inline JS source for the extension (an expression returning the source). */
  code?: string;
  /** …or a URL to fetch the JS source from. */
  codeUrl?: string;
  /** Repo display name this came from (filled in by the loader). */
  repo?: string;
};

// An installed extension — its resolved code is stored so it works offline.
export type InstalledExtension = {
  id: string;
  name: string;
  lang: string;
  version: number;
  code: string;
};
