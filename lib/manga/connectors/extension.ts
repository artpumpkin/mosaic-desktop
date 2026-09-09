// Connector for installed JS extensions (kind "extension"). Resolves the
// compiled extension by source.id from the runtime registry and normalizes
// its loosely-typed output into our domain types.

import { getCompiled } from "../extensions";
import type { MangaConnector, SearchResult } from "../connector";
import type {
  Manga,
  MangaDetail,
  Chapter,
  ReaderPage,
  MangaSource,
  MangaStatus,
} from "../types";

function need(source: MangaSource) {
  const ext = getCompiled(source.id);
  if (!ext)
    throw new Error(
      `Extension "${source.name}" isn't loaded. Try reopening the app or reinstalling it.`,
    );
  return ext;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

function normStatus(s: unknown): MangaStatus {
  const v = String(s ?? "").toLowerCase();
  if (v.includes("ongoing") || v.includes("publishing")) return "ongoing";
  if (v.includes("complete") || v.includes("finished")) return "completed";
  if (v.includes("hiatus")) return "hiatus";
  if (v.includes("cancel")) return "cancelled";
  return "unknown";
}

function toManga(sourceId: string, r: Record<string, unknown>): Manga {
  return {
    sourceId,
    id: String(r.id),
    title: str(r.title) ?? str(r.name) ?? String(r.id),
    cover: str(r.cover) ?? str(r.thumbnail) ?? str(r.image) ?? null,
    status: r.status ? normStatus(r.status) : undefined,
  };
}

export const extensionConnector: MangaConnector = {
  kind: "extension",

  async search(source, query): Promise<SearchResult> {
    const raw = (await need(source).search(query)) as Record<string, unknown>[];
    return { items: (raw ?? []).map((r) => toManga(source.id, r)) };
  },

  async browse(source) {
    const ext = need(source);
    if (!ext.browse) return [];
    const raw = (await ext.browse()) as Record<string, unknown>[];
    return [{ title: ext.name, items: (raw ?? []).map((r) => toManga(source.id, r)) }];
  },

  async getManga(source, mangaId): Promise<MangaDetail> {
    const r = (await need(source).getManga(mangaId)) as Record<string, unknown>;
    const base = toManga(source.id, { ...r, id: mangaId });
    return {
      ...base,
      description: str(r.description) ?? null,
      tags: Array.isArray(r.tags) ? (r.tags as unknown[]).map(String) : [],
      authors: Array.isArray(r.authors) ? (r.authors as unknown[]).map(String) : [],
    };
  },

  async getChapters(source, mangaId): Promise<Chapter[]> {
    const raw = (await need(source).getChapters(mangaId)) as Record<string, unknown>[];
    return (raw ?? []).map((c, i) => ({
      id: String(c.id ?? i),
      number: str(c.number) ?? str(c.chapter) ?? null,
      volume: str(c.volume) ?? null,
      title: str(c.title) ?? str(c.name) ?? null,
      lang: str(c.lang) ?? "en",
      scanlator: str(c.scanlator) ?? str(c.group) ?? null,
      publishedAt: str(c.publishedAt) ?? str(c.date) ?? null,
    }));
  },

  async getPages(source, chapterId): Promise<ReaderPage[]> {
    const raw = (await need(source).getPages(chapterId)) as unknown[];
    return (raw ?? [])
      .map((p, i): ReaderPage | null => {
        const url =
          typeof p === "string"
            ? p
            : str((p as Record<string, unknown>)?.url) ??
              str((p as Record<string, unknown>)?.src);
        return url ? { index: i, url } : null;
      })
      .filter((p): p is ReaderPage => !!p);
  },
};
