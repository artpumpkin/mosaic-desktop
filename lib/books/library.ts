// Local EPUB library: folder scan, metadata extraction, and work linking.

import { exists, mkdir, readDir, readFile, writeFile } from "@tauri-apps/plugin-fs";
import { appDataDir, join } from "@tauri-apps/api/path";
import type { LocalBookEntry } from "./types";
import { extractEpubMeta } from "./epubMeta";
import { logger } from "@/lib/logger";

const DIR_KEY = "mosaic.books.libraryDir";
const ENTRIES_KEY = "mosaic.books.localEntries";
const LINKS_KEY = "mosaic.books.workLinks";
// Tiny, dedicated work-id → downloaded-file-path map. Resolves the Read target
// even if the (larger) entries list fails to persist for any reason.
const DOWNLOADS_KEY = "mosaic.books.downloads";

function loadDownloads(): Record<string, string> {
  try {
    const raw = localStorage.getItem(DOWNLOADS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function saveDownloads(map: Record<string, string>) {
  try {
    localStorage.setItem(DOWNLOADS_KEY, JSON.stringify(map));
  } catch (e) {
    logger.error("books/storage", "saveDownloads FAILED", {
      err: e instanceof Error ? e.message : String(e),
    });
  }
}

export function getDownloadedPathForWork(workId: string): string | null {
  if (!workId) return null;
  return loadDownloads()[workId] ?? null;
}

// Record / look up a downloaded file by an ARBITRARY key (we use the full book
// id, e.g. "ol:OL123W"). Same string at write + read → no parseWorkId mismatch.
export function recordDownloadedPath(key: string, path: string) {
  if (!key) return;
  const dl = loadDownloads();
  dl[key] = path;
  saveDownloads(dl);
}

export function getDownloadedPath(key: string): string | null {
  if (!key) return null;
  return loadDownloads()[key] ?? null;
}

export function getLibraryDir(): string | null {
  try {
    return localStorage.getItem(DIR_KEY);
  } catch {
    return null;
  }
}

export function setLibraryDir(dir: string) {
  try {
    localStorage.setItem(DIR_KEY, dir);
  } catch {
    /* ignore */
  }
}

export function loadLocalEntries(): LocalBookEntry[] {
  try {
    const raw = localStorage.getItem(ENTRIES_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr)
      ? arr.filter(
          (e) =>
            e &&
            typeof e.id === "string" &&
            typeof e.path === "string" &&
            typeof e.title === "string",
        )
      : [];
  } catch {
    return [];
  }
}

function saveLocalEntries(entries: LocalBookEntry[]) {
  try {
    localStorage.setItem(ENTRIES_KEY, JSON.stringify(entries));
  } catch (e) {
    logger.error("books/storage", "saveLocalEntries FAILED (quota?)", {
      count: entries.length,
      err: e instanceof Error ? e.message : String(e),
    });
  }
}

type WorkLinks = Record<string, string>;

function loadWorkLinks(): WorkLinks {
  try {
    const raw = localStorage.getItem(LINKS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as WorkLinks) : {};
  } catch {
    return {};
  }
}

function saveWorkLinks(links: WorkLinks) {
  try {
    localStorage.setItem(LINKS_KEY, JSON.stringify(links));
  } catch {
    /* ignore */
  }
}

export function hashPath(path: string): string {
  let h = 0;
  for (let i = 0; i < path.length; i++) {
    h = (Math.imul(31, h) + path.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

export function localIdForPath(path: string): string {
  return `local:${hashPath(path)}`;
}

export function linkWorkToLocal(workId: string, localId: string) {
  const links = loadWorkLinks();
  links[workId] = localId;
  saveWorkLinks(links);
  const entries = loadLocalEntries();
  const idx = entries.findIndex((e) => e.id === localId);
  if (idx >= 0) {
    entries[idx] = { ...entries[idx], workId };
    saveLocalEntries(entries);
  }
}

export function unlinkWork(workId: string) {
  const links = loadWorkLinks();
  const localId = links[workId];
  delete links[workId];
  saveWorkLinks(links);
  if (localId) {
    const entries = loadLocalEntries();
    const idx = entries.findIndex((e) => e.id === localId);
    if (idx >= 0) {
      entries[idx] = { ...entries[idx], workId: null };
      saveLocalEntries(entries);
    }
  }
}

export function getLinkedLocalId(workId: string): string | null {
  return loadWorkLinks()[workId] ?? null;
}

export function getLocalEntry(id: string): LocalBookEntry | null {
  return loadLocalEntries().find((e) => e.id === id) ?? null;
}

export function getLocalEntryByPath(path: string): LocalBookEntry | null {
  const id = localIdForPath(path);
  return getLocalEntry(id);
}

// Entry whose `workId` field matches — a fallback for the work→local links map
// (downloaded books record their workId directly on the entry, so this resolves
// even if the links map is missing the key).
export function getLocalEntryByWorkId(workId: string): LocalBookEntry | null {
  if (!workId) return null;
  return loadLocalEntries().find((e) => e.workId === workId) ?? null;
}

export function resolveLocalPathForWork(workId: string): string | null {
  const localId = getLinkedLocalId(workId);
  const viaLink = localId ? getLocalEntry(localId)?.path ?? null : null;
  return (
    viaLink ??
    getLocalEntryByWorkId(workId)?.path ??
    getDownloadedPathForWork(workId) ??
    null
  );
}

async function collectEpubPaths(dir: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (base: string) => {
    let entries;
    try {
      entries = await readDir(base);
    } catch {
      return;
    }
    for (const e of entries) {
      const full = `${base}/${e.name}`.replace(/\/+/g, "/");
      if (e.isDirectory) await walk(full);
      else if (e.name.toLowerCase().endsWith(".epub")) out.push(full);
    }
  };
  await walk(dir);
  return out;
}

export async function scanLibrary(dir: string): Promise<LocalBookEntry[]> {
  const paths = await collectEpubPaths(dir);
  const existing = new Map(loadLocalEntries().map((e) => [e.path, e]));
  const entries: LocalBookEntry[] = [];
  const links = loadWorkLinks();

  for (const path of paths) {
    const id = localIdForPath(path);
    const prev = existing.get(path);
    if (prev) {
      entries.push(prev);
      continue;
    }
    try {
      const data = await readFile(path);
      const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      const meta = await extractEpubMeta(buf);
      const entry: LocalBookEntry = {
        id,
        path,
        title: meta.title,
        authors: meta.authors,
        cover: meta.cover ?? null,
        isbns: meta.isbns,
        workId: null,
      };
      entries.push(entry);
    } catch {
      entries.push({
        id,
        path,
        title: path.split("/").pop()?.replace(/\.epub$/i, "") ?? "Untitled",
        authors: [],
      });
    }
  }

  for (const [workId, localId] of Object.entries(links)) {
    const idx = entries.findIndex((e) => e.id === localId);
    if (idx >= 0) entries[idx] = { ...entries[idx], workId };
  }

  setLibraryDir(dir);
  saveLocalEntries(entries);
  return entries;
}

export async function importSingleEpub(path: string): Promise<LocalBookEntry> {
  const data = await readFile(path);
  const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  const meta = await extractEpubMeta(buf);
  const entry: LocalBookEntry = {
    id: localIdForPath(path),
    path,
    title: meta.title,
    authors: meta.authors,
    cover: meta.cover ?? null,
    isbns: meta.isbns,
    workId: null,
  };
  const list = loadLocalEntries().filter((e) => e.path !== path);
  saveLocalEntries([entry, ...list]);
  return entry;
}

// Folder under the app data dir where downloaded books are cached. This dir is
// inside the fs scope (read-app-specific-dirs + the scoped write grant), so the
// EpubReader can read files written here without any user folder selection.
const DOWNLOADS_SUBDIR = "books";

export async function booksDownloadDir(): Promise<string> {
  const dir = await join(await appDataDir(), DOWNLOADS_SUBDIR);
  await mkdir(dir, { recursive: true });
  return dir;
}

// Persist downloaded bytes to the app data cache, register a local library
// entry, optionally link it to an Open Library work, and return the entry.
// EPUBs get full metadata extraction; other formats keep the filename.
export async function importDownloadedBook(
  bytes: Uint8Array,
  filename: string,
  workId?: string | null,
): Promise<LocalBookEntry> {
  logger.info("books/import", "start", { workId, filename, bytes: bytes.byteLength });
  const dir = await booksDownloadDir();
  const path = await join(dir, filename);
  await writeFile(path, bytes);
  let onDisk = false;
  try {
    onDisk = await exists(path);
  } catch (e) {
    logger.warn("books/import", "exists() failed", {
      err: e instanceof Error ? e.message : String(e),
    });
  }
  logger.info("books/import", "wrote file", { path, onDisk });

  const isEpub = filename.toLowerCase().endsWith(".epub");
  let title = filename.replace(/\.[^.]+$/, "");
  let authors: string[] = [];
  let isbns: string[] = [];
  if (isEpub) {
    try {
      const buf = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
      const meta = await extractEpubMeta(buf);
      title = meta.title || title;
      authors = meta.authors;
      isbns = meta.isbns;
    } catch {
      /* keep filename-derived metadata */
    }
  }

  // Persist the work→path map FIRST (tiny, can't blow quota) so the Read target
  // resolves on reopen even if the entries list save fails. Note: we deliberately
  // do NOT store the EPUB's embedded cover — a large illustrated cover (base64
  // data URL) can exceed the localStorage quota and silently drop the whole
  // entries save. The UI shows the Open Library cover instead.
  if (workId) {
    const dl = loadDownloads();
    dl[workId] = path;
    saveDownloads(dl);
    logger.info("books/import", "downloads map saved", {
      workId,
      readback: getDownloadedPathForWork(workId),
      mapKeys: Object.keys(loadDownloads()).length,
    });
  }

  const entry: LocalBookEntry = {
    id: localIdForPath(path),
    path,
    title,
    authors,
    cover: null,
    isbns,
    workId: workId ?? null,
  };
  const list = loadLocalEntries().filter((e) => e.path !== path);
  saveLocalEntries([entry, ...list]);
  const entriesReadback = loadLocalEntries();
  logger.info("books/import", "entries saved", {
    entryId: entry.id,
    persisted: entriesReadback.some((e) => e.id === entry.id),
    count: entriesReadback.length,
  });
  if (workId) linkWorkToLocal(workId, entry.id);
  logger.info("books/import", "done", {
    workId,
    resolveByWork: workId ? resolveLocalPathForWork(workId) : null,
  });
  return entry;
}

export function localEntryToBookItem(e: LocalBookEntry): import("./types").BookItem {
  return {
    id: e.id,
    title: e.title,
    authors: e.authors,
    cover: e.cover ?? null,
    year: null,
    genres: [],
    rating: null,
  };
}

export function clearLocalLibrary() {
  try {
    localStorage.removeItem(ENTRIES_KEY);
    localStorage.removeItem(LINKS_KEY);
    localStorage.removeItem(DIR_KEY);
    localStorage.removeItem(DOWNLOADS_KEY);
  } catch {
    /* ignore */
  }
}

export function localLibraryCount(): number {
  return loadLocalEntries().length;
}
