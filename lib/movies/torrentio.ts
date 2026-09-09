// Torrentio (https://torrentio.strem.fun) is a Stremio addon that aggregates
// torrent indexers and resolves them through debrid services.
//
//   GET /stream/{type}/{id}.json                  → raw torrent metadata
//   GET /realdebrid={token}/stream/{type}/{id}.json → direct MP4/MKV URLs
//
// Without a debrid token: streams carry infoHash + fileIdx and we hand them
// to our bundled librqbit engine (`torrent_start`) to materialise a local
// torrent-stream:// URL.
//
// With a debrid token: each stream's `url` is an HTTPS redirect to a CDN
// that `<video>` can play directly.

import { invoke } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

import { logger } from "@/lib/logger";
import { fetchJsonCached } from "./cache";
import type {
  AddonId,
  Container,
  ContentType,
  Stream,
  TorrentioRawStream,
} from "./types";

const BASE = "https://torrentio.strem.fun";
const STREAM_TTL_MS = 30 * 60 * 1000; // 30 min — torrent availability shifts

const QUALITY_RANK: Record<Stream["quality"], number> = {
  "4K": 5,
  "1080p": 4,
  "720p": 3,
  "480p": 2,
  SD: 1,
};

function parseQuality(text: string): Stream["quality"] {
  if (/\b(2160p|4k|uhd)\b/i.test(text)) return "4K";
  if (/\b1080p\b/i.test(text)) return "1080p";
  if (/\b720p\b/i.test(text)) return "720p";
  if (/\b480p\b/i.test(text)) return "480p";
  return "SD";
}

function parseSeeders(text: string): number {
  // Torrentio formats title lines like "👤 1432 💾 2.31 GB ⚙️ YTS"
  const m = text.match(/👤\s*([\d,]+)/);
  if (m) return parseInt(m[1].replace(/,/g, ""), 10) || 0;
  const fallback = text.match(/\b(\d+)\s*seeders?\b/i);
  return fallback ? parseInt(fallback[1], 10) : 0;
}

function parseSize(text: string): { bytes: number | null; label: string | null } {
  const m = text.match(/💾\s*([\d.]+)\s*(KB|MB|GB|TB)/i)
    ?? text.match(/\b([\d.]+)\s*(KB|MB|GB|TB)\b/i);
  if (!m) return { bytes: null, label: null };
  const n = parseFloat(m[1]);
  const unit = m[2].toUpperCase();
  const mul: Record<string, number> = {
    KB: 1024,
    MB: 1024 ** 2,
    GB: 1024 ** 3,
    TB: 1024 ** 4,
  };
  const bytes = Math.round(n * (mul[unit] ?? 1));
  return { bytes, label: `${m[1]} ${unit}` };
}

function parseProvider(text: string): string | null {
  // The "name" line is usually "Torrentio\n1080p" — provider lives in the
  // title line as "⚙️ YTS" or similar.
  const m = text.match(/⚙️\s*([^\n]+?)(?:\s|$)/);
  return m ? m[1].trim() : null;
}

function parseCodec(text: string): string | null {
  const m = text.match(/\b(x26[45]|h\.?26[45]|hevc|av1)\b/i);
  return m ? m[1].toUpperCase() : null;
}

function parseLanguage(text: string): string | null {
  // Torrentio appends 🇫🇷/🇪🇸/etc emojis for non-English releases.
  const m = text.match(/Multi(?:Audio|Sub)|[A-Z]{2,3}(?:\s+sub)?/);
  return m ? m[0] : null;
}

// Detect container from any filename-like substring in the stream text.
// Torrentio surfaces filenames either in `behaviorHints.filename` (set by
// some indexers) or inline in the title (e.g. "...UHD.BluRay.x265.mkv").
function detectContainer(text: string): Container {
  const lower = text.toLowerCase();
  const m = lower.match(/\.(mp4|mov|webm|mkv|avi|ts|wmv|flv|m4v)\b/);
  if (m) {
    const ext = m[1] === "m4v" ? "mp4" : (m[1] as Container);
    return ext;
  }
  // Heuristics from group/release naming when no extension is present.
  if (/\b(mkv)\b/.test(lower)) return "mkv";
  if (/\b(webm)\b/.test(lower)) return "webm";
  if (/\b(mp4|m4v)\b/.test(lower)) return "mp4";
  return "unknown";
}

// WebKit's <video> natively supports MP4/MOV/M4V, partial WebM. Everything
// else (MKV, AVI, TS, WMV, FLV) errors out at load with
// MEDIA_ERR_SRC_NOT_SUPPORTED *even when* the inside codec is H.264. We
// flag unknown as compatible too, since some streams genuinely lack any
// filename hint and might still be MP4 — better to attempt than skip.
function isWebkitCompatible(container: Container): boolean {
  return (
    container === "mp4" ||
    container === "mov" ||
    container === "webm" ||
    container === "unknown"
  );
}

function fmtSize(n: number): string {
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(0)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function enrichStream(
  raw: TorrentioRawStream,
  addon: AddonId = "torrentio",
): Stream {
  const filename = raw.behaviorHints?.filename ?? null;
  const text = `${raw.name ?? ""}\n${raw.title ?? ""}\n${filename ?? ""}`;
  const quality = parseQuality(text);
  const container = detectContainer(text);
  // Size: prefer Torrentio's exact `behaviorHints.videoSize` (bytes) over the
  // rounded "💾 2.31 GB" text — the text parse occasionally grabs the wrong
  // number (audio "5.1", an unrelated size in the title), which showed up as
  // wrong sizes in the picker. Fall back to the text parse when videoSize is
  // absent.
  const { bytes: textBytes, label: textLabel } = parseSize(text);
  const vs = raw.behaviorHints?.videoSize;
  const exact = typeof vs === "number" && vs > 0 ? vs : null;
  const sizeBytes = exact ?? textBytes;
  const sizeLabel = exact != null ? fmtSize(exact) : textLabel;
  // Real-Debrid streams come pre-remuxed to MP4 by the debrid service, so
  // they're always playable regardless of the original container.
  const isRd = !!raw.url;
  const webkitCompatible = isRd || isWebkitCompatible(container);
  return {
    raw,
    source: isRd ? "realdebrid" : "torrent",
    addons: [addon],
    quality,
    qualityRank: QUALITY_RANK[quality],
    seeders: parseSeeders(text),
    sizeBytes,
    sizeLabel,
    provider: parseProvider(text),
    codec: parseCodec(text),
    language: parseLanguage(text),
    hdr: /\bHDR\b/i.test(text),
    container,
    webkitCompatible,
    filename,
  };
}

// --- Stream addons ---------------------------------------------------------
//
// We aggregate three Stremio addons that all speak the same
// `/stream/{type}/{id}.json` contract:
//
//   • Torrentio    — config is a simple `realdebrid={token}/` path prefix.
//   • Comet        — config is a base64-encoded JSON blob in the path.
//   • MediaFusion  — config is an *encrypted* string the server mints from a
//                    POST to /encrypt-user-data; we cache it per debrid token.
//
// All three are best-effort: fetchStreams fans out with Promise.allSettled and
// silently drops any addon that errors / times out / returns nothing, so a
// flaky or misconfigured source never blocks the others (the user asked for
// Torrentio-like behaviour — "if one can't be used, drop it").

const COMET_BASE = "https://comet.elfhosted.com";
const MEDIAFUSION_BASE = "https://mediafusion.elfhosted.com";

const DEFAULT_ADDONS: AddonId[] = ["torrentio", "comet", "mediafusion"];

// The Stremio id for the targeted title/episode. For anime, `imdbId` is already
// a `kitsu:<id>[:ep]` string and season/episode are left unset, so it passes
// through verbatim — all three addons key on the same id namespace.
function streamId(
  type: ContentType,
  imdbId: string,
  season?: number,
  episode?: number,
): string {
  return type === "series" && season != null && episode != null
    ? `${imdbId}:${season}:${episode}`
    : imdbId;
}

// Which id namespaces each addon can resolve — verified against the live
// endpoints (One Piece kitsu:12, Shawshank tt0111161, Breaking Bad tt0903747):
//   • Torrentio — native Kitsu→torrent mapping; serves anime (kitsu:<id>[:ep]).
//   • Comet     — resolves both IMDb and Kitsu (its manifest lists both id
//     prefixes); returned 50 movie / 39 anime / 50 series streams.
//   • MediaFusion — IMDb (`tt…`) only for ids.
// Mapping Kitsu→IMDb isn't viable: anime uses absolute episode numbering that
// diverges from IMDb season/episode for long runners.
function addonSupportsId(addon: AddonId, id: string): boolean {
  if (addon === "mediafusion") return id.startsWith("tt");
  return true;
}

function buildTorrentioUrl(
  type: ContentType,
  id: string,
  rdToken: string | null,
): string {
  const prefix =
    rdToken && rdToken.trim().length > 0
      ? `realdebrid=${encodeURIComponent(rdToken.trim())}/`
      : "";
  return `${BASE}/${prefix}stream/${type}/${id}.json`;
}

// Standard base64-encode a UTF-8 string. Comet's config segment is plain
// base64 of the JSON (its configure page does `btoa(JSON.stringify(settings))`
// and the server decodes with base64). base64url corrupts the decode.
function b64Encode(input: string): string {
  return btoa(unescape(encodeURIComponent(input)));
}

function buildCometUrl(
  type: ContentType,
  id: string,
  rdToken: string | null,
): string {
  // Comet config — must match the exact v2 schema its configure page emits, or
  // the server returns an "OBSOLETE CONFIGURATION" stub instead of streams. The
  // shape (field names, the `options` defaults, `resultFormat: ["all"]`, the
  // lowercase `stremthruUrl`) is lifted verbatim from comet.elfhosted.com's
  // configure page and verified live: 50 movie / 39 anime / 50 series streams.
  // NOTE: the public ElfHosted instance has non-debrid (torrent) search
  // disabled — without a token Comet returns a single "Non-debrid searches
  // disabled" stub, so fetchAddonStreams skips Comet entirely when no token.
  const hasToken = !!(rdToken && rdToken.trim());
  const config = {
    languages: { required: [], exclude: [], preferred: [] },
    resolutions: {},
    options: {
      remove_ranks_under: -10000000000,
      allow_english_in_languages: false,
      remove_unknown_languages: false,
    },
    maxResultsPerResolution: 0,
    maxSize: 0,
    reverseResultOrder: false,
    removeTrash: true,
    resultFormat: ["all"],
    debridService: hasToken ? "realdebrid" : "torrent",
    debridApiKey: hasToken ? rdToken!.trim() : "",
    debridStreamProxyPassword: "",
    stremthruUrl: "",
  };
  return `${COMET_BASE}/${b64Encode(JSON.stringify(config))}/stream/${type}/${id}.json`;
}

// MediaFusion mints an opaque encrypted config string from a POST. We cache it
// per token for the session so we only pay the round-trip once.
//
// The ElfHosted instance has DIRECT TORRENT DISABLED ("You must select a
// streaming provider"), so without a Real-Debrid token there's nothing to fetch
// — we return null and the addon is dropped.
const mediafusionConfigCache = new Map<string, Promise<string | null>>();

async function mediafusionConfig(rdToken: string | null): Promise<string | null> {
  const token = rdToken?.trim() ?? "";
  if (!token) return null; // elfhosted requires a debrid provider
  const cached = mediafusionConfigCache.get(token);
  if (cached) return cached;
  const promise = (async () => {
    const userData = {
      streaming_provider: {
        service: "realdebrid",
        token,
        enable_watchlist_catalogs: false,
        download_via_browser: false,
        only_show_cached_streams: false,
      },
      // MediaFusion validates this against a strict enum — "4K"/"1440p"/"UHD"
      // are rejected with HTTP 422 ("Invalid resolution"). These are accepted.
      selected_resolutions: ["2160p", "1080p", "720p", "480p", "360p", null],
      enable_catalogs: false,
      enable_imdb_metadata: false,
      max_streams_per_resolution: 0,
      torrent_sorting_priority: [
        { key: "cached", direction: "desc" },
        { key: "resolution", direction: "desc" },
        { key: "seeders", direction: "desc" },
      ],
      show_full_torrent_name: true,
      nudity_filter: ["Disable"],
      certification_filter: ["Disable"],
    };
    try {
      const res = await tauriFetch(`${MEDIAFUSION_BASE}/encrypt-user-data`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(userData),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as {
        status?: string;
        encrypted_str?: string;
      };
      if (json.status && json.status !== "success") {
        throw new Error(`mediafusion: ${json.status}`);
      }
      return json.encrypted_str ?? null;
    } catch (e) {
      logger.warn("movies/streams", "mediafusion config failed", {
        err: e instanceof Error ? e.message : String(e),
      });
      // Cache the failure as null so we don't hammer the endpoint each fetch.
      return null;
    }
  })();
  mediafusionConfigCache.set(token, promise);
  return promise;
}

// Comet on ElfHosted also requires a debrid token (non-debrid search disabled),
// so without one only Torrentio can serve P2P torrents.
function addonUsable(addon: AddonId, rdToken: string | null): boolean {
  if (addon === "torrentio") return true;
  return !!(rdToken && rdToken.trim());
}

async function buildMediafusionUrl(
  type: ContentType,
  id: string,
  rdToken: string | null,
): Promise<string | null> {
  const config = await mediafusionConfig(rdToken);
  if (!config) return null;
  return `${MEDIAFUSION_BASE}/${config}/stream/${type}/${id}.json`;
}

async function fetchAddonStreams(
  addon: AddonId,
  type: ContentType,
  id: string,
  rdToken: string | null,
): Promise<Stream[]> {
  let url: string | null;
  if (addon === "torrentio") url = buildTorrentioUrl(type, id, rdToken);
  else if (addon === "comet") url = buildCometUrl(type, id, rdToken);
  else url = await buildMediafusionUrl(type, id, rdToken);
  if (!url) return [];
  const json = await fetchJsonCached<{ streams?: TorrentioRawStream[] }>(
    url,
    STREAM_TTL_MS,
  );
  return (json.streams ?? []).map((raw) => enrichStream(raw, addon));
}

export type StreamFetchArgs = {
  type: ContentType;
  imdbId: string;
  rdToken: string | null;
  season?: number;
  episode?: number;
  /** Restrict to a subset of addons; defaults to all three. */
  addons?: AddonId[];
};

// Fan out across every enabled addon in parallel. Each addon is independent —
// a rejection (network error, bad config, addon down) is logged and dropped, so
// the surviving addons still populate the picker.
export async function fetchStreams(args: StreamFetchArgs): Promise<Stream[]> {
  const { type, imdbId, rdToken, season, episode } = args;
  const requested = args.addons?.length ? args.addons : DEFAULT_ADDONS;
  const id = streamId(type, imdbId, season, episode);
  // Drop addons that can't serve this request, so we don't surface their
  // empty/stub fallbacks: MediaFusion can't resolve Kitsu anime ids, and on
  // ElfHosted both Comet and MediaFusion require a debrid token (non-debrid
  // search is disabled).
  const addons = requested.filter(
    (addon) => addonSupportsId(addon, id) && addonUsable(addon, rdToken),
  );
  const results = await Promise.allSettled(
    addons.map((addon) => fetchAddonStreams(addon, type, id, rdToken)),
  );
  const out: Stream[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      out.push(...r.value);
    } else {
      logger.warn("movies/streams", "addon fetch failed", {
        addon: addons[i],
        err:
          r.reason instanceof Error ? r.reason.message : String(r.reason),
      });
    }
  });
  return out;
}

// Reputable release groups / trackers. Sources from these are far more likely
// to be a clean, correctly-labelled encode (vs. mislabelled cams / fakes), so
// they get a ranking boost.
const TRUSTED_PROVIDERS =
  /\b(YTS|YIFY|RARBG|1337x|TorrentGalaxy|TGx|GalaxyRG|MeGusta|EZTV|QxR|PSA|Tigole|NTb|SPARKS|AMIABLE|FraMeSToR|playWEB|HONE)\b/i;

function isTrustedProvider(p: string | null): boolean {
  return !!p && TRUSTED_PROVIDERS.test(p);
}

// Minimum plausible file size per quality — tuned to catch obvious fakes /
// samples (a "1080p" in 30 MB, a "4K" in 200 MB) WITHOUT filtering legit short
// content (a 1080p 22-min TV episode can be ~300 MB, so the floor stays well
// below that). Movies sit far above these; only junk falls under.
function minBytesFor(q: Stream["quality"]): number {
  switch (q) {
    case "4K":
      return 600_000_000; // 600 MB
    case "1080p":
      return 120_000_000; // 120 MB
    case "720p":
      return 60_000_000; // 60 MB
    case "480p":
      return 30_000_000; // 30 MB
    default:
      return 20_000_000; // 20 MB
  }
}

// A stream worth surfacing: a live swarm (real seeders) and a plausible size.
// Real-Debrid streams are always healthy (the debrid service already has the
// file). This is what filters out dead torrents and fakes.
export function isHealthyStream(s: Stream): boolean {
  if (s.source === "realdebrid") return true;
  if (s.seeders <= 0) return false; // dead — nothing to stream from
  if (s.sizeBytes != null && s.sizeBytes < minBytesFor(s.quality)) return false;
  return true;
}

// Composite quality score. 1080p is the sweet spot (best size/quality/seed
// balance); 4K is demoted because it has far fewer seeders and saturates most
// links. Seeders are log-scaled so a (possibly inflated) huge count can't
// alone vault a mediocre release to the top — it nudges, doesn't dominate.
function streamScore(s: Stream): number {
  const qualW: Record<Stream["quality"], number> = {
    "1080p": 100,
    "720p": 80,
    "4K": 72,
    "480p": 45,
    SD: 20,
  };
  const seedW = Math.log2(Math.max(0, s.seeders) + 1) * 12;
  const rdW = s.source === "realdebrid" ? 30 : 0;
  const trustW = isTrustedProvider(s.provider) ? 18 : 0;
  const hdrW = s.hdr ? 4 : 0;
  return qualW[s.quality] + seedW + rdW + trustW + hdrW;
}

// Dedupe → health-filter → score-sort. This is the single entry point the
// Movies page uses, so the picker only ever sees quality sources, best first.
//
//   1. Dedupe by infoHash: Torrentio lists the same torrent under several
//      trackers with differing seeder reads — collapse to the highest read.
//   2. Drop dead (0-seed) and fake/sample (implausibly small) sources. If that
//      would empty the list (obscure title, all low-health), keep the deduped
//      set so the user still has something to try.
//   3. Sort by the composite score, tie-broken by raw seeders then size.
export function rankStreams(streams: Stream[]): Stream[] {
  const byKey = new Map<string, Stream>();
  for (const s of streams) {
    const key =
      s.raw.infoHash?.toLowerCase() ??
      s.raw.url ??
      `${s.quality}:${s.sizeBytes ?? 0}`;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, s);
    } else {
      // Same torrent surfaced by multiple addons — keep the higher seeder read
      // but remember every source that found it so the picker can badge them.
      const mergedAddons = Array.from(new Set([...prev.addons, ...s.addons]));
      const winner = s.seeders > prev.seeders ? s : prev;
      byKey.set(key, { ...winner, addons: mergedAddons });
    }
  }
  const deduped = [...byKey.values()];
  const healthy = deduped.filter(isHealthyStream);
  const pool = healthy.length > 0 ? healthy : deduped;
  return pool.sort((a, b) => {
    const ds = streamScore(b) - streamScore(a);
    if (Math.abs(ds) > 0.5) return ds;
    if (a.seeders !== b.seeders) return b.seeders - a.seeders;
    return (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0);
  });
}

export function pickBest(streams: Stream[]): Stream | null {
  // rankStreams already floats the best quality + well-seeded source to the
  // top (and filters out junk), so the best pick is simply the first.
  return rankStreams(streams)[0] ?? null;
}

// --- Stream materialisation -----------------------------------------------

type TorrentStartResult = {
  stream_url: string;
  info_hash: string;
  file_idx: number;
};

// Turn an enriched Stream into a URL the <video> element can play. For RD
// streams that's a no-op; for torrent streams we boot up librqbit (via the
// Tauri command in src-tauri/src/torrent.rs) and use the custom URI scheme
// it exposes.
export async function resolveStreamUrl(stream: Stream): Promise<string> {
  if (stream.source === "realdebrid" && stream.raw.url) {
    return stream.raw.url;
  }
  const infoHash = stream.raw.infoHash;
  if (!infoHash) {
    throw new Error("Stream has neither url nor infoHash");
  }
  // Tauri auto-converts Rust snake_case command args to camelCase on the JS
  // side (info_hash → infoHash). Sending snake_case fails ACL/arg parsing.
  logger.info("movies/torrent", "torrent_start invoke", {
    infoHash,
    fileIdx: stream.raw.fileIdx ?? null,
    quality: stream.quality,
    seeders: stream.seeders,
    provider: stream.provider,
    sizeLabel: stream.sizeLabel,
    container: stream.container,
    webkitCompatible: stream.webkitCompatible,
    filename: stream.filename,
  });
  const t0 = performance.now();
  try {
    const res = await invoke<TorrentStartResult>("torrent_start", {
      infoHash,
      fileIdx: stream.raw.fileIdx ?? null,
    });
    logger.info("movies/torrent", "torrent_start ok", {
      infoHash,
      streamUrl: res.stream_url,
      ms: Math.round(performance.now() - t0),
    });
    return res.stream_url;
  } catch (e) {
    logger.error("movies/torrent", "torrent_start failed", {
      infoHash,
      err: e instanceof Error ? e.message : String(e),
      ms: Math.round(performance.now() - t0),
    });
    throw e;
  }
}

// Info hashes we've already kicked off a background metadata fetch for, so
// repeated hovers over the same row don't re-invoke the engine.
const prewarmed = new Set<string>();

// Fire-and-forget the expensive magnet→metadata step *before* the user
// commits to a stream. `torrent_start` is idempotent on the Rust side
// (AlreadyManaged returns the same handle), so when `resolveStreamUrl` runs
// for real on click, librqbit already has the metadata + warm peers and
// returns near-instantly instead of blocking on a cold DHT lookup.
//
// Only torrents benefit — RD streams are already direct URLs. Errors are
// swallowed: this is a speculative optimisation, the real resolve on click
// surfaces any genuine failure.
export function prewarmStream(stream: Stream): void {
  if (stream.source !== "torrent") return;
  const infoHash = stream.raw.infoHash;
  if (!infoHash || prewarmed.has(infoHash)) return;
  prewarmed.add(infoHash);
  logger.debug("movies/torrent", "prewarm", {
    infoHash,
    quality: stream.quality,
    seeders: stream.seeders,
  });
  invoke<TorrentStartResult>("torrent_start", {
    infoHash,
    fileIdx: stream.raw.fileIdx ?? null,
  }).catch((e) => {
    // Drop from the set so a later real pick can retry cleanly.
    prewarmed.delete(infoHash);
    logger.debug("movies/torrent", "prewarm failed (ignored)", {
      infoHash,
      err: e instanceof Error ? e.message : String(e),
    });
  });
}

// Base URL of the local torrent HTTP streaming server, e.g.
// "http://127.0.0.1:54321". Used on the libmpv (macOS) path, where the
// torrent-stream:// custom scheme isn't reachable: callers rewrite a
// torrent-stream://localhost/... URL's prefix to this. Returns "" if the
// server hasn't bound (then the caller should fall back to the scheme URL).
export async function torrentHttpBase(): Promise<string> {
  try {
    return await invoke<string>("torrent_http_base");
  } catch {
    return "";
  }
}

// Rewrite a torrent-stream://localhost/{hash}/{idx} URL to the local HTTP
// server so libmpv can fetch it. Non-torrent URLs (Real-Debrid http) and an
// unbound server are passed through unchanged.
export function toMpvStreamUrl(streamUrl: string, httpBase: string): string {
  const SCHEME = "torrent-stream://localhost";
  if (httpBase && streamUrl.startsWith(SCHEME)) {
    return httpBase + streamUrl.slice(SCHEME.length);
  }
  return streamUrl;
}

export async function stopTorrent(infoHash: string): Promise<void> {
  logger.info("movies/torrent", "torrent_stop invoke", { infoHash });
  try {
    await invoke("torrent_stop", { infoHash });
    logger.info("movies/torrent", "torrent_stop ok", { infoHash });
  } catch (e) {
    logger.warn("movies/torrent", "torrent_stop failed (ignored)", {
      infoHash,
      err: e instanceof Error ? e.message : String(e),
    });
  }
}

export type TorrentStatus = {
  downloaded_bytes: number;
  uploaded_bytes: number;
  total_bytes: number;
  download_rate_bps: number;
  state: string;
  finished: boolean;
  error: string | null;
  active: boolean;
  /** Peers currently exchanging data with us. */
  peers_live: number;
  /** Peers seen in the swarm (via tracker/DHT). */
  peers_seen: number;
  /** Peers we're mid-handshake with. */
  peers_connecting: number;
};

export async function torrentStatus(infoHash: string): Promise<TorrentStatus> {
  return invoke<TorrentStatus>("torrent_status", { infoHash });
}
