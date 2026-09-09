// Suwayomi / Tachidesk connector — the generic, user-added kind. Each
// instance points at a self-hosted Suwayomi-Server (source.url), which runs
// the full Tachiyomi/Mihon extension catalog. This is how a user "adds any
// source": install extensions on their server, then search them from here.
//
// Uses the Suwayomi REST API (v1). Images are proxied by the server itself,
// so page/cover URLs load directly via <img>. Best-effort: behaviour depends
// on which extensions the user has installed on their server.

import { mfetch } from "../fetch";
import type { MangaConnector, SearchOpts, SearchResult } from "../connector";
import type {
  Manga,
  MangaDetail,
  Chapter,
  ReaderPage,
  MangaSource,
  MangaStatus,
} from "../types";

const SEARCH_SOURCE_CAP = 6; // search at most N installed sources

function base(source: MangaSource): string {
  return source.url.replace(/\/+$/, "");
}

async function getJson<T>(url: string): Promise<T> {
  const res = await mfetch(url, { method: "GET", headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Suwayomi ${res.status} for ${url}`);
  return (await res.json()) as T;
}

function thumbUrl(b: string, mangaId: number | string): string {
  return `${b}/api/v1/manga/${mangaId}/thumbnail`;
}

function normStatus(s: unknown): MangaStatus {
  const v = String(s ?? "").toLowerCase();
  if (v.includes("ongoing") || v.includes("publishing")) return "ongoing";
  if (v.includes("completed") || v.includes("finished")) return "completed";
  if (v.includes("hiatus")) return "hiatus";
  if (v.includes("cancel")) return "cancelled";
  return "unknown";
}

type RawManga = {
  id: number;
  title?: string;
  thumbnailUrl?: string;
  description?: string;
  author?: string;
  status?: string;
  genre?: string[];
};

function mapManga(source: MangaSource, b: string, m: RawManga): Manga {
  return {
    sourceId: source.id,
    id: String(m.id),
    title: m.title ?? "Untitled",
    cover: thumbUrl(b, m.id),
    status: normStatus(m.status),
  };
}

export const suwayomiConnector: MangaConnector = {
  kind: "suwayomi",

  async search(
    source: MangaSource,
    query: string,
    _opts?: SearchOpts,
  ): Promise<SearchResult> {
    const b = base(source);
    const sources = await getJson<{ id: string; lang?: string }[]>(
      `${b}/api/v1/source/list`,
    );
    // Prefer English / language-agnostic sources, then cap the fan-out.
    const picked = sources
      .filter((s) => !s.lang || s.lang === "en" || s.lang === "all")
      .slice(0, SEARCH_SOURCE_CAP);
    const lists = await Promise.allSettled(
      picked.map((s) =>
        getJson<{ mangaList?: RawManga[] }>(
          `${b}/api/v1/source/${s.id}/search?searchTerm=${encodeURIComponent(query)}&pageNum=1`,
        ),
      ),
    );
    const items: Manga[] = [];
    const seen = new Set<string>();
    for (const r of lists) {
      if (r.status !== "fulfilled") continue;
      for (const m of r.value.mangaList ?? []) {
        const mapped = mapManga(source, b, m);
        if (seen.has(mapped.id)) continue;
        seen.add(mapped.id);
        items.push(mapped);
      }
    }
    return { items };
  },

  async getManga(source, mangaId): Promise<MangaDetail> {
    const b = base(source);
    const m = await getJson<RawManga>(
      `${b}/api/v1/manga/${mangaId}/?onlineFetch=true`,
    );
    return {
      ...mapManga(source, b, m),
      description: m.description ?? null,
      authors: m.author ? [m.author] : [],
      tags: m.genre ?? [],
    };
  },

  async getChapters(source, mangaId): Promise<Chapter[]> {
    const b = base(source);
    type RawChapter = {
      index: number;
      name?: string;
      chapterNumber?: number;
      scanlator?: string | null;
      uploadDate?: number;
    };
    const list = await getJson<RawChapter[]>(
      `${b}/api/v1/manga/${mangaId}/chapters?onlineFetch=true`,
    );
    // Encode mangaId into the chapter id so getPages can build page URLs
    // (Suwayomi page endpoints need both manga + chapter index).
    const chapters: Chapter[] = list.map((c) => ({
      id: `${mangaId}:${c.index}`,
      number:
        c.chapterNumber != null && c.chapterNumber >= 0
          ? String(c.chapterNumber)
          : null,
      title: c.name ?? null,
      lang: "en",
      scanlator: c.scanlator ?? null,
      publishedAt: c.uploadDate ? new Date(c.uploadDate).toISOString() : null,
    }));
    // Suwayomi returns descending by index; present ascending.
    return chapters.reverse();
  },

  async getPages(source, chapterId): Promise<ReaderPage[]> {
    const b = base(source);
    const [mangaId, index] = chapterId.split(":");
    const meta = await getJson<{ pageCount?: number }>(
      `${b}/api/v1/manga/${mangaId}/chapter/${index}`,
    );
    const count = meta.pageCount ?? 0;
    return Array.from({ length: count }, (_, i) => ({
      index: i,
      url: `${b}/api/v1/manga/${mangaId}/chapter/${index}/page/${i}`,
    }));
  },
};
