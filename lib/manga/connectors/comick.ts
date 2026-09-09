// Comick connector — secondary built-in source. JSON API at api.comick.fun,
// images served from meo.comick.pictures (loaded via <img>).
//
// NOTE: Comick sits behind Cloudflare and can intermittently rate-limit or
// challenge requests. It is intentionally the *secondary* source — MangaDex
// is the reliable primary — and the manga page tolerates a source erroring.

import { mfetch } from "../fetch";
import { rateLimited } from "../http";
import type {
  MangaConnector,
  SearchOpts,
  SearchResult,
  BrowseOpts,
} from "../connector";
import type {
  Manga,
  MangaDetail,
  Chapter,
  ReaderPage,
  MangaSource,
  MangaStatus,
} from "../types";

const API = "https://api.comick.fun";
const IMG = "https://meo.comick.pictures";
const UA = "Mosaic/1.0 (+https://github.com/mosaic)";

const call = rateLimited("comick", { perSec: 3 });

async function getJson<T>(path: string): Promise<T> {
  const res = await call(() =>
    mfetch(`${API}${path}`, {
      method: "GET",
      headers: { "User-Agent": UA, Accept: "application/json" },
    }),
  );
  if (!res.ok) throw new Error(`Comick ${res.status} for ${path}`);
  return (await res.json()) as T;
}

function coverFrom(covers?: { b2key?: string }[]): string | null {
  const key = covers?.find((c) => c.b2key)?.b2key;
  return key ? `${IMG}/${key}` : null;
}

function normStatus(s: unknown): MangaStatus {
  switch (s) {
    case 1:
      return "ongoing";
    case 2:
      return "completed";
    case 3:
      return "cancelled";
    case 4:
      return "hiatus";
    default:
      return "unknown";
  }
}

type RawComic = {
  hid: string;
  slug?: string;
  title?: string;
  desc?: string;
  year?: number | null;
  status?: number;
  md_covers?: { b2key?: string }[];
  md_comic_md_genres?: { md_genres?: { name?: string } }[];
};

export const comickConnector: MangaConnector = {
  kind: "comick",

  async search(
    source: MangaSource,
    query: string,
    opts?: SearchOpts,
  ): Promise<SearchResult> {
    const limit = opts?.limit ?? 20;
    const json = await getJson<RawComic[]>(
      `/v1.0/search?q=${encodeURIComponent(query)}&limit=${limit}&page=1`,
    );
    const items: Manga[] = (Array.isArray(json) ? json : []).map((c) => ({
      sourceId: source.id,
      id: c.hid,
      title: c.title ?? "Untitled",
      cover: coverFrom(c.md_covers),
      year: c.year ?? null,
      status: normStatus(c.status),
    }));
    return { items };
  },

  async browse(source, opts?: BrowseOpts) {
    const sortMap: Record<string, string> = {
      popular: "follow",
      latest: "uploaded",
      rating: "rating",
      newest: "created_at",
    };
    const sort = sortMap[opts?.sort ?? "popular"] ?? "follow";
    const titleMap: Record<string, string> = {
      follow: "Popular on Comick",
      uploaded: "Latest on Comick",
      rating: "Top rated on Comick",
      created_at: "New on Comick",
    };
    const json = await getJson<RawComic[]>(
      `/v1.0/search?sort=${sort}&limit=24&page=1`,
    );
    return [
      {
        title: titleMap[sort] ?? "Popular on Comick",
        items: (Array.isArray(json) ? json : []).map((c) => ({
          sourceId: source.id,
          id: c.hid,
          title: c.title ?? "Untitled",
          cover: coverFrom(c.md_covers),
          year: c.year ?? null,
          status: normStatus(c.status),
        })),
      },
    ];
  },

  async getManga(source, mangaId): Promise<MangaDetail> {
    const json = await getJson<{ comic?: RawComic }>(
      `/comic/${mangaId}?tachiyomi=true`,
    );
    const c = json.comic ?? ({ hid: mangaId } as RawComic);
    return {
      sourceId: source.id,
      id: mangaId,
      title: c.title ?? "Untitled",
      cover: coverFrom(c.md_covers),
      year: c.year ?? null,
      status: normStatus(c.status),
      description: c.desc ?? null,
      tags: (c.md_comic_md_genres ?? [])
        .map((g) => g.md_genres?.name)
        .filter((x): x is string => !!x),
    };
  },

  async getChapters(_source, mangaId): Promise<Chapter[]> {
    type RawChapter = {
      hid: string;
      chap?: string | null;
      vol?: string | null;
      title?: string | null;
      lang?: string;
      group_name?: string[] | null;
      created_at?: string;
    };
    const out: Chapter[] = [];
    let page = 1;
    // Comick caps page size internally; loop until a page returns nothing.
    for (; page <= 50; page++) {
      const json = await getJson<{ chapters?: RawChapter[] }>(
        `/comic/${mangaId}/chapters?lang=en&page=${page}`,
      );
      const batch = json.chapters ?? [];
      if (!batch.length) break;
      for (const c of batch) {
        out.push({
          id: c.hid,
          number: c.chap ?? null,
          volume: c.vol ?? null,
          title: c.title ?? null,
          lang: c.lang ?? "en",
          scanlator: c.group_name?.join(", ") ?? null,
          publishedAt: c.created_at ?? null,
        });
      }
    }
    // Comick returns newest-first; normalize to ascending and dedupe by chap.
    out.reverse();
    const seen = new Set<string>();
    return out.filter((c) => {
      const k = c.number ?? `__${c.id}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  },

  async getPages(_source, chapterId): Promise<ReaderPage[]> {
    type RawImg = { b2key?: string; url?: string };
    const json = await getJson<{ chapter?: { md_images?: RawImg[] } }>(
      `/chapter/${chapterId}?tachiyomi=true`,
    );
    const imgs = json.chapter?.md_images ?? [];
    return imgs
      .map((im, i) => {
        const url = im.url ?? (im.b2key ? `${IMG}/${im.b2key}` : null);
        return url ? { index: i, url } : null;
      })
      .filter((x): x is ReaderPage => !!x);
  },
};
