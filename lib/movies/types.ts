// Types mirror the Stremio addon contracts: Cinemeta (catalog + metadata),
// Torrentio (streams), OpenSubtitles (subtitle tracks). We keep fields
// permissive — these are public addons that evolve without notice and we
// only consume a subset.

export type ContentType = "movie" | "series";

// --- Cinemeta -------------------------------------------------------------

export type CatalogItem = {
  id: string; // IMDb id, e.g. "tt0111161"
  type: ContentType;
  name: string;
  poster?: string | null;
  background?: string | null;
  logo?: string | null;
  imdbRating?: string | null;
  releaseInfo?: string | null; // "1994" or "2008–2013"
  genres?: string[];
  runtime?: string | null;
  description?: string | null;
};

export type EpisodeMeta = {
  id: string; // "tt0903747:1:1" — IMDb:Season:Episode
  season: number;
  episode: number;
  name?: string;
  title?: string;
  overview?: string | null;
  thumbnail?: string | null;
  released?: string | null;
  firstAired?: string | null;
};

export type Meta = CatalogItem & {
  cast?: string[];
  director?: string[];
  writer?: string[];
  country?: string | null;
  awards?: string | null;
  videos?: EpisodeMeta[]; // populated for series
  trailers?: { source: string; type: string }[];
};

// --- Stream addons --------------------------------------------------------

// The Stremio stream addons we aggregate. All three speak the same
// `/stream/{type}/{id}.json` contract; they differ only in base URL and how
// their config (debrid token) is encoded into the path. See lib/movies/torrentio.ts.
export type AddonId = "torrentio" | "comet" | "mediafusion";

export const ADDON_LABELS: Record<AddonId, string> = {
  torrentio: "Torrentio",
  comet: "Comet",
  mediafusion: "MediaFusion",
};

// Torrentio's raw stream shape. `url` is present when called under a debrid
// path (e.g. realdebrid={token}); otherwise we get infoHash + fileIdx and
// need the torrent engine to materialize a playable URL.
//
// Comet and MediaFusion return the same shape (Stremio stream objects), so this
// type doubles as their raw stream type too.
export type TorrentioRawStream = {
  name?: string;
  title?: string; // multi-line free-form, has quality/seeders/source/size
  url?: string;
  infoHash?: string;
  fileIdx?: number;
  behaviorHints?: {
    bingeGroup?: string;
    filename?: string;
    videoSize?: number;
  };
};

// Container shorthand. WebKit's <video> can natively play `mp4`, `mov`, and
// some `webm` files; everything else (mkv, avi, ts, …) is rejected at
// load-time with MEDIA_ERR_SRC_NOT_SUPPORTED, even when the underlying
// codec is H.264. Use `webkitCompatible` to filter the picker so the user
// isn't fed sources that can never play.
export type Container =
  | "mp4"
  | "mov"
  | "webm"
  | "mkv"
  | "avi"
  | "ts"
  | "wmv"
  | "flv"
  | "unknown";

// Our parsed/enriched view that the UI binds to.
export type Stream = {
  raw: TorrentioRawStream;
  source: "realdebrid" | "torrent"; // how we'll play it
  // Which addon(s) surfaced this torrent. Usually one; when the same infoHash
  // comes back from several addons, dedupe merges their ids here so the picker
  // can badge/filter by source.
  addons: AddonId[];
  // Display fields parsed out of Torrentio's title text:
  quality: "4K" | "1080p" | "720p" | "480p" | "SD";
  qualityRank: number; // higher = better, used for sorting
  seeders: number;
  sizeBytes: number | null;
  sizeLabel: string | null;
  provider: string | null; // e.g. "YTS", "RARBG", "1337x"
  codec: string | null; // e.g. "x265", "x264"
  language: string | null;
  hdr: boolean;
  /** Container detected from filename/title (e.g. "mkv", "mp4"). */
  container: Container;
  /** True when WebKit's <video> is likely to play this source. */
  webkitCompatible: boolean;
  /** Detected filename, when surfaced by Torrentio. */
  filename: string | null;
};

// --- OpenSubtitles --------------------------------------------------------

export type Subtitle = {
  id: string;
  url: string; // SRT URL (we'll convert to VTT before feeding <track>)
  lang: string; // ISO 639-2/B (e.g. "eng", "fre")
  label?: string;
};

// --- Local persistence ----------------------------------------------------

export type WatchProgress = {
  id: string; // IMDb id or "tt…:S:E"
  type: ContentType;
  position: number; // seconds
  duration: number; // seconds
  watchedAt: number; // epoch ms
  name: string;
  poster?: string | null;
  // For series episodes: parent show + display label.
  seriesId?: string;
  episodeLabel?: string;
  // Remembered track selections, re-applied on resume. Matched by LANGUAGE,
  // not track id — ids aren't stable across torrent sources/files. `subKind`
  // separates an embedded sub track from an external (OpenSubtitles/custom)
  // sub, vs. the user having turned subs off.
  audioLang?: string | null;
  audioTitle?: string | null;
  subKind?: "internal" | "external" | "off" | null;
  subLang?: string | null;
  subId?: string | null; // external Subtitle.id when subKind === "external"
};
