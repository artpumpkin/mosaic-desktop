// Reading progress + read/unread tracking for the Manga reader. localStorage,
// same rationale as lib/movies/progress.ts: tiny volumes, zero round-trips
// while turning pages.

import { seriesKey, type MangaReadProgress } from "./types";

const PROGRESS_KEY = "mosaic.manga.progress";
const READ_CHAPTERS_KEY = "mosaic.manga.readChapters";

// --- Reading position (per series) ----------------------------------------

type ProgressMap = Record<string, MangaReadProgress>;

function readProgress(): ProgressMap {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as ProgressMap) : {};
  } catch {
    return {};
  }
}

function writeProgress(map: ProgressMap) {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(map));
  } catch {
    /* quota — acceptable to lose */
  }
}

export function getMangaProgress(
  sourceId: string,
  mangaId: string,
): MangaReadProgress | null {
  return readProgress()[seriesKey(sourceId, mangaId)] ?? null;
}

export function saveMangaProgress(p: MangaReadProgress) {
  const map = readProgress();
  map[p.key] = p;
  writeProgress(map);
}

export function clearMangaProgress(sourceId: string, mangaId: string) {
  const map = readProgress();
  const key = seriesKey(sourceId, mangaId);
  if (key in map) {
    delete map[key];
    writeProgress(map);
  }
}

// Most-recently-read first — drives the "Continue reading" rail.
export function listInProgress(): MangaReadProgress[] {
  return Object.values(readProgress()).sort((a, b) => b.updatedAt - a.updatedAt);
}

// --- Read / unread chapters (per series) -----------------------------------

type ReadMap = Record<string, string[]>; // seriesKey -> chapterId[]

function readReadMap(): ReadMap {
  try {
    const raw = localStorage.getItem(READ_CHAPTERS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as ReadMap) : {};
  } catch {
    return {};
  }
}

function writeReadMap(map: ReadMap) {
  try {
    localStorage.setItem(READ_CHAPTERS_KEY, JSON.stringify(map));
  } catch {
    /* quota */
  }
}

export function getReadChapters(
  sourceId: string,
  mangaId: string,
): Set<string> {
  return new Set(readReadMap()[seriesKey(sourceId, mangaId)] ?? []);
}

export function markChapterRead(
  sourceId: string,
  mangaId: string,
  chapterId: string,
) {
  const map = readReadMap();
  const key = seriesKey(sourceId, mangaId);
  const list = new Set(map[key] ?? []);
  if (list.has(chapterId)) return;
  list.add(chapterId);
  map[key] = [...list];
  writeReadMap(map);
}

// Throttle reader page-turn writes (mirrors movies throttledSaver).
export function throttledSaver(intervalMs: number) {
  let last = 0;
  return (p: MangaReadProgress) => {
    const now = Date.now();
    if (now - last < intervalMs) return;
    last = now;
    saveMangaProgress(p);
  };
}
