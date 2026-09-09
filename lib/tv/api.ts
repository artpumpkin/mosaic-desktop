import type {
  TvChannel,
  TvStream,
  TvCategory,
  TvCountry,
  TvLanguage,
  TvLogo,
  TvDataset,
} from "./types";
import { BUILTIN_IPTV_ORG_ID, type TvSource } from "./sources";
import { parseM3u, type M3uEntry } from "./m3u";
import { idbGet, idbSet, idbDel, idbKeys } from "@/lib/idbCache";

const ENDPOINTS = {
  channels: "https://iptv-org.github.io/api/channels.json",
  streams: "https://iptv-org.github.io/api/streams.json",
  categories: "https://iptv-org.github.io/api/categories.json",
  countries: "https://iptv-org.github.io/api/countries.json",
  languages: "https://iptv-org.github.io/api/languages.json",
  logos: "https://iptv-org.github.io/api/logos.json",
} as const;

// v3 lives in IndexedDB. v2 used localStorage, whose ~5MB quota the multi-MB
// dataset overflowed — the write threw, was swallowed, and the list
// re-downloaded every launch.
const CACHE_PREFIX = "mosaic.tv.cache.v3";
const LEGACY_LS_PREFIX = "mosaic.tv.cache.v2";
const TTL_MS = 24 * 60 * 60 * 1000;

type Cached = {
  fetchedAt: number;
  data: TvDataset;
};

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json() as Promise<T>;
}

async function fetchIptvOrgFresh(): Promise<TvDataset> {
  const [channels, streams, categories, countries, languages, logos] = await Promise.all([
    fetchJson<TvChannel[]>(ENDPOINTS.channels),
    fetchJson<TvStream[]>(ENDPOINTS.streams),
    fetchJson<TvCategory[]>(ENDPOINTS.categories),
    fetchJson<TvCountry[]>(ENDPOINTS.countries),
    fetchJson<TvLanguage[]>(ENDPOINTS.languages),
    fetchJson<TvLogo[]>(ENDPOINTS.logos).catch(() => [] as TvLogo[]),
  ]);
  return { channels, streams, categories, countries, languages, logos };
}

// Convert a parsed M3U playlist into the iptv-org-shaped TvDataset so the
// existing TV UI (rails, filters, player) works unchanged.
function buildDatasetFromM3u(entries: M3uEntry[]): TvDataset {
  const channels: TvChannel[] = [];
  const streams: TvStream[] = [];
  const seenChannelIds = new Set<string>();
  const categorySet = new Map<string, string>(); // id → friendly name
  const countrySet = new Set<string>();
  let anon = 0;

  for (const e of entries) {
    const baseId = (e.tvgId || e.name || `entry-${++anon}`).trim();
    let id = baseId;
    // Disambiguate duplicate ids by appending an index.
    if (seenChannelIds.has(id)) {
      let i = 2;
      while (seenChannelIds.has(`${baseId}#${i}`)) i++;
      id = `${baseId}#${i}`;
    }
    seenChannelIds.add(id);

    const groupRaw = e.groupTitle?.trim() || "General";
    const categoryId = groupRaw.toLowerCase();
    if (!categorySet.has(categoryId)) categorySet.set(categoryId, groupRaw);
    const country = (e.country || "INT").toUpperCase();
    countrySet.add(country);

    channels.push({
      id,
      name: e.name || id,
      country,
      categories: [categoryId],
      logo: e.tvgLogo ?? null,
      languages: e.language ? [e.language] : [],
    });
    streams.push({ channel: id, url: e.url, quality: null });
  }

  const categories: TvCategory[] = [...categorySet.entries()].map(([id, name]) => ({
    id,
    name,
  }));
  const countries: TvCountry[] = [...countrySet].map((code) =>
    code === "INT"
      ? { code: "INT", name: "International", flag: "🌐" }
      : { code, name: code, flag: undefined },
  );

  return {
    channels,
    streams,
    categories,
    countries,
    languages: [],
    logos: [],
  };
}

async function fetchM3uFresh(url: string): Promise<TvDataset> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  const text = await res.text();
  const entries = parseM3u(text);
  if (entries.length === 0) {
    throw new Error("Playlist parsed empty — is the URL pointing to an M3U file?");
  }
  return buildDatasetFromM3u(entries);
}

// Adult/XXX content is filtered out unconditionally. Matches the iptv-org
// "xxx" category id as well as common adult group titles seen in M3U
// playlists. Kept narrow (no bare "adult") so legit channels like
// "Adult Swim" survive.
const ADULT_RE = /\b(xxx|porn|nsfw|hardcore|x-?rated|18\+|adults?\s*only|erotic)\b/i;

// Drop adult channels, their streams, and the adult category from a dataset.
// Applied to every dataset we return — both freshly fetched and read from an
// existing cache — so previously cached XXX entries disappear without forcing
// a re-download.
function sanitizeDataset(data: TvDataset): TvDataset {
  const adultCatIds = new Set(
    data.categories
      .filter((c) => ADULT_RE.test(c.id) || ADULT_RE.test(c.name))
      .map((c) => c.id),
  );
  const isAdult = (c: TvChannel) =>
    ADULT_RE.test(c.name ?? "") ||
    (c.categories ?? []).some(
      (cid) => adultCatIds.has(cid) || ADULT_RE.test(cid),
    );
  const channels = data.channels.filter((c) => !isAdult(c));
  const keptIds = new Set(channels.map((c) => c.id));
  return {
    ...data,
    channels,
    streams: data.streams.filter((s) => s.channel !== null && keptIds.has(s.channel)),
    categories: data.categories.filter(
      (c) => !adultCatIds.has(c.id) && !ADULT_RE.test(c.id) && !ADULT_RE.test(c.name),
    ),
  };
}

async function fetchFreshFor(source: TvSource): Promise<TvDataset> {
  if (source.kind === "m3u") {
    if (!source.url) throw new Error("M3U URL is empty");
    return sanitizeDataset(await fetchM3uFresh(source.url));
  }
  return sanitizeDataset(await fetchIptvOrgFresh());
}

function cacheKeyFor(sourceId: string): string {
  return `${CACHE_PREFIX}.${sourceId}`;
}

async function readCache(sourceId: string): Promise<Cached | null> {
  const c = await idbGet<Cached>(cacheKeyFor(sourceId));
  if (c && c.data && typeof c.fetchedAt === "number") return c;
  return null;
}

async function writeCache(sourceId: string, data: TvDataset) {
  await idbSet(cacheKeyFor(sourceId), { fetchedAt: Date.now(), data } as Cached);
  // Drop any stale localStorage copy from the pre-IndexedDB scheme.
  try {
    localStorage.removeItem(`${LEGACY_LS_PREFIX}.${sourceId}`);
  } catch {
    /* ignore */
  }
}

export async function clearTvCache(sourceId: string) {
  await idbDel(cacheKeyFor(sourceId));
  try {
    localStorage.removeItem(`${LEGACY_LS_PREFIX}.${sourceId}`);
  } catch {
    /* ignore */
  }
}

/** Wipe every cached source dataset (Manage data UI). */
export async function clearAllTvCache() {
  const keys = await idbKeys();
  await Promise.all(
    keys.filter((k) => k.startsWith(CACHE_PREFIX)).map((k) => idbDel(k)),
  );
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(LEGACY_LS_PREFIX)) localStorage.removeItem(k);
    }
  } catch {
    /* ignore */
  }
}

export type TvFetchResult = {
  data: TvDataset;
  fetchedAt: number;
  fromCache: boolean;
  /** Cache age exceeded the TTL — caller should revalidate in the background. */
  stale: boolean;
};

// Stale-while-revalidate read: returns the cached dataset IMMEDIATELY if we
// have one (at ANY age), flagging `stale` when it's past the TTL so the caller
// can refresh in the background behind an "updating" indicator. Only blocks on
// the network when there's no cache at all (first run for this source).
export async function loadTvData(source: TvSource): Promise<TvFetchResult> {
  const cached = await readCache(source.id);
  if (cached) {
    return {
      data: sanitizeDataset(cached.data),
      fetchedAt: cached.fetchedAt,
      fromCache: true,
      stale: Date.now() - cached.fetchedAt > TTL_MS,
    };
  }
  const data = await fetchFreshFor(source);
  await writeCache(source.id, data);
  return { data, fetchedAt: Date.now(), fromCache: false, stale: false };
}

export async function refreshTvData(source: TvSource): Promise<TvFetchResult> {
  const data = await fetchFreshFor(source);
  await writeCache(source.id, data);
  return { data, fetchedAt: Date.now(), fromCache: false, stale: false };
}

export { BUILTIN_IPTV_ORG_ID };

// Build a lookup from channel id → streams for that channel.
export function indexStreamsByChannel(streams: TvStream[]): Map<string, TvStream[]> {
  const map = new Map<string, TvStream[]>();
  for (const s of streams) {
    if (!s.channel) continue;
    const list = map.get(s.channel);
    if (list) list.push(s);
    else map.set(s.channel, [s]);
  }
  return map;
}

// Build channel id → logo URL (prefer square-ish, then any).
export function indexLogosByChannel(logos: TvLogo[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const l of logos) {
    if (!l.channel || !l.url) continue;
    if (!map.has(l.channel)) map.set(l.channel, l.url);
  }
  return map;
}
