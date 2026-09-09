// Radio support for the TV section. Radio stations map cleanly onto the
// existing iptv-org-shaped TvDataset (station = channel, station stream =
// TvStream, tags → genre categories), so the whole TV UI — rails, filters,
// favorites, the player — works unchanged once we feed it a radio dataset.
//
// Data comes from the community Radio Browser directory
// (https://www.radio-browser.info / https://api.radio-browser.info), which is
// free and CORS-open. There's no single fixed host — the project runs a pool
// of mirrors behind round-robin DNS — so we try a handful of known mirrors in
// turn until one answers.

import type {
  TvChannel,
  TvStream,
  TvCategory,
  TvCountry,
  TvDataset,
} from "./types";
import type { TvFetchResult } from "./api";
import { idbGet, idbSet, idbDel } from "@/lib/idbCache";
import { invoke } from "@tauri-apps/api/core";

const CACHE_KEY = "mosaic.radio.cache.v1";
const TTL_MS = 24 * 60 * 60 * 1000;

// Mirrors of the Radio Browser API, tried in order. The project recommends
// resolving these dynamically, but a static list of the long-lived public
// mirrors is simpler and good enough — we fall through on any failure.
const RADIO_SERVERS = [
  "https://de1.api.radio-browser.info",
  "https://nl1.api.radio-browser.info",
  "https://at1.api.radio-browser.info",
  "https://fi1.api.radio-browser.info",
];

// How many stations to pull. Ordered by popularity (clickcount), so the cut
// keeps the stations people actually listen to. ~3000 keeps the payload a few
// MB while still covering the long tail of genres/countries.
const STATION_LIMIT = 3000;

type RadioStation = {
  stationuuid: string;
  name: string;
  url: string;
  url_resolved?: string;
  favicon?: string;
  tags?: string;
  country?: string;
  countrycode?: string;
  language?: string;
  languagecodes?: string;
  codec?: string;
  bitrate?: number;
  lastcheckok?: number;
};

type Cached = { fetchedAt: number; data: TvDataset };

// Bucket a station's free-form tags into one of a curated set of broad genres
// so the rails stay sane (raw Radio Browser tags number in the thousands).
// First matching rule wins; unmatched stations land in "various".
const GENRE_RULES: [string, string[]][] = [
  ["news", ["news", "talk", "information", "politics", "current affairs"]],
  ["pop", ["pop", "top 40", "top40", "hits", "charts", "adult contemporary"]],
  ["rock", ["rock", "alternative", "indie", "punk", "grunge", "classic rock"]],
  ["metal", ["metal", "hardcore", "thrash"]],
  ["electronic", ["electronic", "edm", "house", "techno", "trance", "dance", "dnb", "drum and bass", "dubstep", "electro"]],
  ["hiphop", ["hip hop", "hip-hop", "hiphop", "rap", "r&b", "rnb", "urban", "trap"]],
  ["jazz", ["jazz", "swing", "bebop", "smooth jazz"]],
  ["classical", ["classical", "opera", "symphony", "baroque", "orchestral"]],
  ["country", ["country", "bluegrass", "americana"]],
  ["blues", ["blues", "soul", "funk", "motown"]],
  ["reggae", ["reggae", "ska", "dancehall", "dub"]],
  ["latin", ["latin", "salsa", "reggaeton", "bachata", "cumbia", "merengue"]],
  ["oldies", ["oldies", "60s", "70s", "80s", "90s", "classic hits", "retro", "nostalgia"]],
  ["folk", ["folk", "acoustic", "singer-songwriter", "celtic"]],
  ["ambient", ["ambient", "chillout", "chill", "lounge", "relax", "meditation", "new age"]],
  ["religious", ["christian", "gospel", "religious", "religion", "islamic", "spiritual", "worship"]],
  ["sports", ["sport", "sports", "football", "soccer"]],
  ["kids", ["kids", "children", "disney", "family"]],
  ["world", ["world", "ethnic", "folklore", "traditional", "arabic", "bollywood", "afrobeat"]],
];

const GENRE_NAMES: Record<string, string> = {
  news: "News & Talk",
  pop: "Pop",
  rock: "Rock",
  metal: "Metal",
  electronic: "Electronic",
  hiphop: "Hip-Hop & R&B",
  jazz: "Jazz",
  classical: "Classical",
  country: "Country",
  blues: "Blues & Soul",
  reggae: "Reggae",
  latin: "Latin",
  oldies: "Oldies",
  folk: "Folk",
  ambient: "Ambient & Chill",
  religious: "Religious",
  sports: "Sports",
  kids: "Kids",
  world: "World",
  various: "Various",
};

function bucketGenre(tags: string | undefined): string {
  if (!tags) return "various";
  const lower = tags.toLowerCase();
  for (const [genre, needles] of GENRE_RULES) {
    if (needles.some((n) => lower.includes(n))) return genre;
  }
  return "various";
}

// Two-letter country code → flag emoji via regional-indicator codepoints, so
// radio countries get the same flags TV channels show.
function flagEmoji(code: string): string | undefined {
  if (!/^[A-Za-z]{2}$/.test(code)) return undefined;
  const up = code.toUpperCase();
  return String.fromCodePoint(
    0x1f1e6 + up.charCodeAt(0) - 65,
    0x1f1e6 + up.charCodeAt(1) - 65,
  );
}

function mapStations(stations: RadioStation[]): TvDataset {
  const channels: TvChannel[] = [];
  const streams: TvStream[] = [];
  const seen = new Set<string>();
  const genresUsed = new Set<string>();
  const countryNames = new Map<string, string>(); // code → name

  for (const s of stations) {
    const id = s.stationuuid?.trim();
    const url = (s.url_resolved || s.url || "").trim();
    if (!id || !url || seen.has(id)) continue;
    if (s.lastcheckok === 0) continue;
    seen.add(id);

    const genre = bucketGenre(s.tags);
    genresUsed.add(genre);

    const code = (s.countrycode || "").toUpperCase();
    const country = code && /^[A-Z]{2}$/.test(code) ? code : "INT";
    if (country !== "INT" && !countryNames.has(country)) {
      countryNames.set(country, s.country?.trim() || country);
    }

    const favicon = s.favicon?.trim();
    channels.push({
      id,
      name: s.name?.trim() || id,
      country,
      categories: [genre],
      logo: favicon && /^https?:\/\//i.test(favicon) ? favicon : null,
      languages: s.languagecodes
        ? s.languagecodes.split(",").map((l) => l.trim()).filter(Boolean)
        : [],
    });
    streams.push({
      channel: id,
      url,
      quality: s.bitrate ? `${s.bitrate}k` : null,
    });
  }

  const categories: TvCategory[] = [...genresUsed].map((id) => ({
    id,
    name: GENRE_NAMES[id] ?? id,
  }));
  const countries: TvCountry[] = [
    { code: "INT", name: "International", flag: "🌐" },
    ...[...countryNames.entries()].map(([code, name]) => ({
      code,
      name,
      flag: flagEmoji(code),
    })),
  ];

  return { channels, streams, categories, countries, languages: [], logos: [] };
}

async function fetchRadioFresh(): Promise<TvDataset> {
  const path = `/json/stations/search?hidebroken=true&order=clickcount&reverse=true&limit=${STATION_LIMIT}`;
  let lastErr: unknown = null;
  for (const base of RADIO_SERVERS) {
    try {
      const res = await fetch(`${base}${path}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`${base} → ${res.status}`);
      const stations = (await res.json()) as RadioStation[];
      if (!Array.isArray(stations) || stations.length === 0) {
        throw new Error(`${base} → empty station list`);
      }
      return mapStations(stations);
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(
    `All Radio Browser mirrors failed: ${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    }`,
  );
}

async function readCache(): Promise<Cached | null> {
  const c = await idbGet<Cached>(CACHE_KEY);
  if (c && c.data && typeof c.fetchedAt === "number") return c;
  return null;
}

async function writeCache(data: TvDataset) {
  await idbSet(CACHE_KEY, { fetchedAt: Date.now(), data } as Cached);
}

export async function clearRadioCache() {
  await idbDel(CACHE_KEY);
}

// Stale-while-revalidate read, mirroring loadTvData: return any cached dataset
// immediately (flagging `stale` past the TTL) and only block on the network on
// the very first run.
export async function loadRadioData(): Promise<TvFetchResult> {
  const cached = await readCache();
  if (cached) {
    return {
      data: cached.data,
      fetchedAt: cached.fetchedAt,
      fromCache: true,
      stale: Date.now() - cached.fetchedAt > TTL_MS,
    };
  }
  const data = await fetchRadioFresh();
  await writeCache(data);
  return { data, fetchedAt: Date.now(), fromCache: false, stale: false };
}

export async function refreshRadioData(): Promise<TvFetchResult> {
  const data = await fetchRadioFresh();
  await writeCache(data);
  return { data, fetchedAt: Date.now(), fromCache: false, stale: false };
}

// --- Audio proxy (real-time spectrum) -------------------------------------
// The radio player routes audio through a localhost proxy (src-tauri/src/
// radio_proxy.rs) that re-serves the stream with CORS headers, so a Web Audio
// AnalyserNode in the WebView can read the real spectrum to drive the
// visualization. Without the proxy (e.g. it failed to bind), callers fall back
// to direct playback + the simulated visualization.

let proxyBaseCache: string | null = null;

/** Base URL of the local audio proxy, or "" if unavailable. Cached after first call. */
export async function radioProxyBase(): Promise<string> {
  if (proxyBaseCache !== null) return proxyBaseCache;
  try {
    proxyBaseCache = await invoke<string>("radio_proxy_base");
  } catch {
    proxyBaseCache = "";
  }
  return proxyBaseCache;
}

/** Wrap a stream URL so it flows through the proxy. Returns the raw url if no base. */
export function proxiedRadioUrl(base: string, streamUrl: string): string {
  if (!base) return streamUrl;
  return `${base}/?url=${encodeURIComponent(streamUrl)}`;
}
