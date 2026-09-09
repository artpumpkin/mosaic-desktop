// Read-side aggregation for the Dashboard "Up next" rail. Pulls in-progress
// items from each media section's own localStorage (Movies, Manga, TV) and
// normalizes them into one timeline. No new storage of its own — each section
// stays the single source of truth for its own progress; this just reads and
// merges. Extensible: add Anime / Audio here as those sections land.
//
// localStorage-backed, so call this only on the client (inside an effect).

import { listInProgress as listMovieProgress } from "@/lib/movies/progress";
import { listInProgress as listMangaProgress } from "@/lib/manga/progress";
import { listInProgress as listAnimeProgress } from "@/lib/anime/progress";
import { listInProgress as listBookProgress } from "@/lib/books/progress";
import { listInProgress as listAudioProgress } from "@/lib/audio/progress";
import { loadTvRecents } from "@/lib/tv/storage";

export type ContinueKind = "movie" | "series" | "manga" | "tv" | "anime" | "book" | "audio";

export type ContinueItem = {
  key: string; // unique within the queue
  kind: ContinueKind;
  title: string;
  cover: string | null;
  // 0..1 watch/read progress; null when the medium has no resume position
  // (live TV — you just re-tune).
  fraction: number | null;
  badge: string | null; // e.g. "S1 · E5", "Ch. 1054", "Live TV"
  updatedAt: number; // epoch ms — drives the merged sort
  href: string; // deep link that resumes in the owning section
};

export function loadContinueQueue(limit = 24): ContinueItem[] {
  const out: ContinueItem[] = [];

  // --- Movies & series ---
  for (const p of listMovieProgress()) {
    const fraction = p.duration > 0 ? Math.min(0.99, p.position / p.duration) : 0;
    out.push({
      key: `movie:${p.id}`,
      kind: p.type, // "movie" | "series"
      title: p.name,
      cover: p.poster ?? null,
      fraction,
      badge: p.episodeLabel ?? null,
      updatedAt: p.watchedAt,
      href: `/movies?resume=${encodeURIComponent(p.id)}`,
    });
  }

  // --- Anime (own store; movie/series subtype collapses to one "anime" kind) ---
  for (const p of listAnimeProgress()) {
    const fraction = p.duration > 0 ? Math.min(0.99, p.position / p.duration) : 0;
    out.push({
      key: `anime:${p.id}`,
      kind: "anime",
      title: p.name,
      cover: p.poster ?? null,
      fraction,
      badge: p.episodeLabel ?? null,
      updatedAt: p.watchedAt,
      href: `/anime?resume=${encodeURIComponent(p.id)}`,
    });
  }

  // --- Manga ---
  for (const p of listMangaProgress()) {
    const fraction =
      p.pageCount > 0 ? Math.min(0.99, (p.pageIndex + 1) / p.pageCount) : 0;
    out.push({
      key: `manga:${p.key}`,
      kind: "manga",
      title: p.title,
      cover: p.cover ?? null,
      fraction,
      badge: p.chapterNumber ? `Ch. ${p.chapterNumber}` : null,
      updatedAt: p.updatedAt,
      href: `/manga?resume=${encodeURIComponent(p.key)}`,
    });
  }

  // --- Books ---
  for (const p of listBookProgress()) {
    out.push({
      key: `book:${p.key}`,
      kind: "book",
      title: p.title,
      cover: p.cover ?? null,
      fraction: Math.min(0.99, p.fraction),
      badge: p.fraction > 0 ? `${Math.round(p.fraction * 100)}%` : null,
      updatedAt: p.updatedAt,
      href: `/books?resume=${encodeURIComponent(p.key)}`,
    });
  }

  // --- Audio (podcast episodes + Audius music share one progress log) ---
  for (const p of listAudioProgress()) {
    const fraction = p.duration > 0 ? Math.min(0.99, p.position / p.duration) : 0;
    out.push({
      key: `audio:${p.key}`,
      kind: "audio",
      title: p.title,
      cover: p.cover ?? null,
      fraction,
      badge: p.artist ?? (p.kind === "podcast" ? "Podcast" : "Music"),
      updatedAt: p.updatedAt,
      href: "/audio",
    });
  }

  // --- Live TV (recently watched channels; no resume position) ---
  for (const r of loadTvRecents()) {
    out.push({
      key: `tv:${r.id}`,
      kind: "tv",
      title: r.name,
      cover: r.logo ?? null,
      fraction: null,
      badge: "Live TV",
      updatedAt: r.at,
      href: `/tv?play=${encodeURIComponent(r.id)}`,
    });
  }

  out.sort((a, b) => b.updatedAt - a.updatedAt);
  return out.slice(0, limit);
}
