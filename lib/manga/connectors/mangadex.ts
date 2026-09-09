// MangaDex connector — the primary built-in source. Free, no API key, and it
// carries every title the user asked for (One Piece, Kingdom, Bleach,
// Berserk, Chainsaw Man, My Hero Academia).
//
// Networking goes through @tauri-apps/plugin-http's fetch (the app convention,
// see lib/integrations/coingecko.ts) which bypasses CORS; the host is
// allow-listed in src-tauri/capabilities/default.json. Page images load via
// plain <img> (CSP is disabled), so we only fetch JSON here.

import { mfetch } from "../fetch";
import { rateLimited } from "../http";
import type {
  MangaConnector,
  SearchOpts,
  SearchResult,
  BrowseOpts,
} from "../connector";
import type { BrowseSort } from "../genres";
import type {
  Manga,
  MangaDetail,
  Chapter,
  ReaderPage,
  MangaSource,
  MangaStatus,
} from "../types";

const API = "https://api.mangadex.org";
const UPLOADS = "https://uploads.mangadex.org";
const RATING =
  "&contentRating[]=safe&contentRating[]=suggestive&contentRating[]=erotica";

// ~5 req/s on the API, 40/min on at-home; stay comfortably under both.
const callApi = rateLimited("mangadex-api", { perSec: 4 });
const callAtHome = rateLimited("mangadex-athome", { perMin: 35 });

async function getJson<T>(
  url: string,
  bucket = callApi,
): Promise<T> {
  const res = await bucket(() => mfetch(url, { method: "GET" }));
  if (!res.ok) throw new Error(`MangaDex ${res.status} for ${url}`);
  return (await res.json()) as T;
}

const SORT_PARAM: Record<BrowseSort, string> = {
  popular: "order[followedCount]=desc",
  latest: "order[latestUploadedChapter]=desc",
  rating: "order[rating]=desc",
  newest: "order[createdAt]=desc",
};

function coverUrl(mangaId: string, fileName?: string | null): string | null {
  return fileName ? `${UPLOADS}/covers/${mangaId}/${fileName}.512.jpg` : null;
}

// MangaDex titles are a lang→string map; prefer English, then romaji/JP.
function pickTitle(
  t: Record<string, string> = {},
  alts: Record<string, string>[] = [],
): string {
  return (
    t.en ??
    t["ja-ro"] ??
    t.ja ??
    Object.values(t)[0] ??
    alts.flatMap((a) => Object.values(a))[0] ??
    "Untitled"
  );
}

function normStatus(s: unknown): MangaStatus {
  return s === "ongoing" ||
    s === "completed" ||
    s === "hiatus" ||
    s === "cancelled"
    ? s
    : "unknown";
}

type RawManga = {
  id: string;
  attributes?: {
    title?: Record<string, string>;
    altTitles?: Record<string, string>[];
    description?: Record<string, string>;
    status?: string;
    year?: number | null;
    contentRating?: string;
    tags?: { attributes?: { name?: Record<string, string> } }[];
  };
  relationships?: {
    type: string;
    attributes?: { fileName?: string; name?: string };
  }[];
};

function mapManga(sourceId: string, d: RawManga): Manga {
  const cover = d.relationships?.find((r) => r.type === "cover_art");
  return {
    sourceId,
    id: d.id,
    title: pickTitle(d.attributes?.title, d.attributes?.altTitles),
    cover: coverUrl(d.id, cover?.attributes?.fileName),
    year: d.attributes?.year ?? null,
    status: normStatus(d.attributes?.status),
  };
}

export const mangadexConnector: MangaConnector = {
  kind: "mangadex",

  async search(
    source: MangaSource,
    query: string,
    opts?: SearchOpts,
  ): Promise<SearchResult> {
    const limit = opts?.limit ?? 20;
    const offset = opts?.offset ?? 0;
    const url =
      `${API}/manga?title=${encodeURIComponent(query)}` +
      `&limit=${limit}&offset=${offset}` +
      `&includes[]=cover_art&order[relevance]=desc${RATING}`;
    const json = await getJson<{ data?: RawManga[]; total?: number }>(url);
    return {
      items: (json.data ?? []).map((d) => mapManga(source.id, d)),
      total: json.total,
    };
  },

  async browse(source, opts?: BrowseOpts) {
    const sort: BrowseSort = opts?.sort ?? "popular";
    const genre = opts?.genre ?? null;
    const titleBySort: Record<BrowseSort, string> = {
      popular: "Popular on MangaDex",
      latest: "Latest updates",
      rating: "Top rated",
      newest: "Newly added",
    };
    const url =
      `${API}/manga?limit=30&includes[]=cover_art&${SORT_PARAM[sort]}` +
      (genre ? `&includedTags[]=${genre}` : "") +
      RATING;
    const json = await getJson<{ data?: RawManga[] }>(url);
    return [
      {
        title: titleBySort[sort],
        items: (json.data ?? []).map((d) => mapManga(source.id, d)),
      },
    ];
  },

  async getManga(source, mangaId): Promise<MangaDetail> {
    const url =
      `${API}/manga/${mangaId}` +
      `?includes[]=cover_art&includes[]=author&includes[]=artist`;
    const json = await getJson<{ data: RawManga }>(url);
    const d = json.data;
    const a = d.attributes ?? {};
    const base = mapManga(source.id, d);
    const description =
      a.description?.en ?? Object.values(a.description ?? {})[0] ?? null;
    return {
      ...base,
      description,
      tags: (a.tags ?? [])
        .map((t) => t.attributes?.name?.en)
        .filter((x): x is string => !!x),
      authors: (d.relationships ?? [])
        .filter((r) => r.type === "author" || r.type === "artist")
        .map((r) => r.attributes?.name)
        .filter((x): x is string => !!x),
      altTitles: (a.altTitles ?? [])
        .map((m) => m.en ?? Object.values(m)[0])
        .filter((x): x is string => !!x),
      contentRating: a.contentRating ?? null,
    };
  },

  // One Piece has 1100+ chapters — page the feed (500/call) until exhausted.
  async getChapters(_source, mangaId): Promise<Chapter[]> {
    type RawChapter = {
      id: string;
      attributes?: {
        chapter?: string | null;
        volume?: string | null;
        title?: string | null;
        translatedLanguage?: string;
        pages?: number;
        publishAt?: string;
      };
      relationships?: { type: string; attributes?: { name?: string } }[];
    };
    const out: Chapter[] = [];
    let offset = 0;
    let total = Infinity;
    while (offset < total) {
      const url =
        `${API}/manga/${mangaId}/feed?translatedLanguage[]=en` +
        `&order[volume]=asc&order[chapter]=asc&limit=500&offset=${offset}` +
        `&includes[]=scanlation_group${RATING}`;
      const json = await getJson<{ data?: RawChapter[]; total?: number }>(url);
      total = json.total ?? out.length;
      const batch = json.data ?? [];
      for (const c of batch) {
        const a = c.attributes ?? {};
        if (a.translatedLanguage !== "en") continue;
        out.push({
          id: c.id,
          number: a.chapter ?? null,
          volume: a.volume ?? null,
          title: a.title ?? null,
          lang: a.translatedLanguage ?? "en",
          pages: a.pages ?? null,
          publishedAt: a.publishAt ?? null,
          scanlator:
            c.relationships?.find((r) => r.type === "scanlation_group")
              ?.attributes?.name ?? null,
        });
      }
      if (!batch.length) break;
      offset += 500;
    }
    // Multiple scanlations share a chapter number — keep the first (the feed
    // is ordered, so this is the earliest-volume / canonical entry).
    const seen = new Set<string>();
    return out.filter((c) => {
      const k = c.number ?? `__${c.id}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  },

  async getPages(_source, chapterId): Promise<ReaderPage[]> {
    type AtHome = {
      baseUrl: string;
      chapter: { hash: string; data?: string[]; dataSaver?: string[] };
    };
    const json = await getJson<AtHome>(
      `${API}/at-home/server/${chapterId}`,
      callAtHome,
    );
    const { baseUrl, chapter } = json;
    const { hash, data = [], dataSaver = [] } = chapter;
    return data.map((file, i) => ({
      index: i,
      url: `${baseUrl}/data/${hash}/${file}`,
      urlDataSaver: dataSaver[i]
        ? `${baseUrl}/data-saver/${hash}/${dataSaver[i]}`
        : null,
    }));
  },
};
