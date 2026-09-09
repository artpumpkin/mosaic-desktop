// Library Genesis search + direct download for the Books section.
//
// Libgen has no debrid/torrent layer for individual books — each result
// resolves to a plain HTTP download link off a mirror, so there's no
// Real-Debrid involvement here (unlike the Movies stream addons).
//
// Targets the current libgen.li-family mirrors (the older libgen.is/.rs/.st
// domains are dead). Their layout, verified live (2026-05):
//   • Search:   GET {base}/index.php?req={query}
//               → an HTML table#tablelibgen, one <tr> per edition.
//   • Download: GET {base}/ads.php?md5={md5}
//               → a page with a "GET" link to get.php?md5=…&key=…
//               → that link 307-redirects to the actual file bytes.
//
// Mirror domains and markup shift often; every step is best-effort with
// fallbacks and never throws past the public entry points (which return []).

import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { logger } from "@/lib/logger";

export type LibgenResult = {
  md5: string;
  title: string;
  authors: string[];
  extension: string; // lowercased: epub, pdf, mobi, azw3…
  sizeLabel: string | null;
  sizeBytes: number | null;
  year: string | null;
  language: string | null;
};

// Live mirrors (libgen.li fork). Tried in order until one responds.
const MIRRORS = [
  "https://libgen.li",
  "https://libgen.vg",
  "https://libgen.bz",
  "https://libgen.gl",
  "https://libgen.la",
];

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15";

const EXT_RE = /^(epub|pdf|mobi|azw3?|fb2|djvu|djv|txt|rtf|cbz|cbr|lit|chm|doc|docx)$/i;
const SIZE_UNITS: Record<string, number> = {
  kb: 1024,
  mb: 1024 ** 2,
  gb: 1024 ** 3,
};

// Require an explicit kB/MB/GB unit — a bare "b" matches the series number +
// a badge letter in the title cell ("…sorciers 1 b" → a bogus 1-byte size).
function parseSize(text: string): { bytes: number | null; label: string | null } {
  const m = text.match(/([\d.]+)\s*(kb|mb|gb)\b/i);
  if (!m) return { bytes: null, label: null };
  const n = parseFloat(m[1]);
  const bytes = Math.round(n * (SIZE_UNITS[m[2].toLowerCase()] ?? 1));
  return { bytes, label: `${m[1]} ${m[2].toUpperCase()}` };
}

async function fetchText(
  url: string,
  timeoutMs = 15000,
  signal?: AbortSignal,
): Promise<string> {
  const res = await tauriFetch(url, {
    method: "GET",
    headers: { "User-Agent": UA, Accept: "text/html,*/*" },
    connectTimeout: timeoutMs,
    signal,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function parseDoc(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

const MD5_RE = /[a-f0-9]{32}/i;

function md5FromRow(row: Element): string | null {
  for (const a of row.querySelectorAll("a[href]")) {
    const href = a.getAttribute("href") ?? "";
    const m = href.match(/md5=([a-f0-9]{32})/i) ?? href.match(/\/([a-f0-9]{32})\b/i);
    if (m) return m[1].toLowerCase();
  }
  return null;
}

// Parse the libgen.li-family results table. We locate fields by content
// (md5 anywhere in the row, the cell whose text is a known extension, the cell
// matching a size string) rather than rigid column indices, so minor layout
// differences between mirrors don't break parsing.
function parseTable(html: string): LibgenResult[] {
  const doc = parseDoc(html);
  const table =
    doc.querySelector("table#tablelibgen") ??
    [...doc.querySelectorAll("table")].sort(
      (a, b) => b.querySelectorAll("tr").length - a.querySelectorAll("tr").length,
    )[0];
  if (!table) return [];
  const rows = [...table.querySelectorAll("tr")];
  const out: LibgenResult[] = [];
  for (const row of rows) {
    const cells = [...row.querySelectorAll("td")];
    if (cells.length < 5) continue; // header / spacer rows
    const md5 = md5FromRow(row);
    if (!md5) continue;

    // Title: the edition.php anchor carrying visible text (the first such
    // anchor is an empty tooltip icon, so pick the one with real text).
    const titleCell = cells[0];
    const titleAnchor =
      [...titleCell.querySelectorAll('a[href*="edition.php"]')].find(
        (a) => (a.textContent ?? "").trim().length > 1,
      ) ?? titleCell.querySelector("a[href]");
    const title =
      (titleAnchor?.textContent ?? "").trim() ||
      (titleCell.textContent ?? "").replace(/\s+/g, " ").trim();
    if (!title) continue;

    // Extension + size by content scan.
    let extension = "unknown";
    let sizeLabel: string | null = null;
    let sizeBytes: number | null = null;
    for (const c of cells) {
      const t = (c.textContent ?? "").trim();
      if (extension === "unknown" && EXT_RE.test(t)) extension = t.toLowerCase();
      if (sizeBytes == null) {
        const s = parseSize(t);
        if (s.bytes != null) {
          sizeBytes = s.bytes;
          sizeLabel = s.label;
        }
      }
    }

    // Author cell is formatted "Author(s) - Series- n"; keep the pre-dash
    // segment and split multiple authors on ;/,.
    const authors = (cells[1]?.textContent ?? "")
      .split(/\s+-\s+/)[0]
      .split(/\s*[;,]\s*/)
      .map((s) => s.trim())
      .filter((s) => s && !MD5_RE.test(s))
      .slice(0, 4);

    // Year (4 digits) and language, if a cell carries them.
    let year: string | null = null;
    let language: string | null = null;
    for (const c of cells.slice(2)) {
      const t = (c.textContent ?? "").trim();
      if (!year && /^(1[5-9]\d{2}|20\d{2})$/.test(t)) year = t;
      if (!language && /^[A-Za-z][A-Za-z ]{2,}$/.test(t) && !EXT_RE.test(t)) {
        language = t;
      }
    }

    out.push({
      md5,
      title,
      authors,
      extension,
      sizeLabel,
      sizeBytes,
      year,
      language,
    });
  }
  return out;
}

export type LibgenQuery = {
  title: string;
  author?: string | null;
  isbn?: string | null;
};

// Candidate queries in precision order. ISBN is most precise WHEN indexed, but
// a given edition's ISBN is often missing from Libgen (e.g. it returned 0 for
// Harry Potter's first ISBN while title+author returned 50), so we fall back to
// title+author and then title-only.
function buildQueries(q: LibgenQuery): string[] {
  const out: string[] = [];
  if (q.isbn && q.isbn.trim()) out.push(q.isbn.trim());
  const titleAuthor = [q.title, q.author].filter(Boolean).join(" ").trim();
  if (titleAuthor) out.push(titleAuthor);
  if (q.title.trim() && q.title.trim() !== titleAuthor) out.push(q.title.trim());
  return [...new Set(out)];
}

async function runSearch(query: string): Promise<LibgenResult[]> {
  const path = `/index.php?req=${encodeURIComponent(query)}&res=50`;
  for (const base of MIRRORS) {
    try {
      const html = await fetchText(`${base}${path}`);
      const rows = parseTable(html);
      if (rows.length > 0) {
        const byMd5 = new Map<string, LibgenResult>();
        for (const r of rows) if (!byMd5.has(r.md5)) byMd5.set(r.md5, r);
        return [...byMd5.values()];
      }
    } catch (e) {
      logger.warn("books/libgen", "search mirror failed", {
        base,
        query,
        err: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return [];
}

// Try each candidate query until one yields results.
export async function searchLibgen(q: LibgenQuery): Promise<LibgenResult[]> {
  for (const query of buildQueries(q)) {
    const rows = await runSearch(query);
    if (rows.length > 0) return rows;
  }
  return [];
}

// --- download resolution ---------------------------------------------------

// Scrape the direct download URL from an ads.php page. The "GET" link points to
// get.php?md5=…&key=… (relative); absolutize against the page's host.
function extractDownloadUrl(html: string, base: string): string | null {
  const doc = parseDoc(html);
  const anchors = [...doc.querySelectorAll("a[href]")];
  const get =
    anchors.find((a) => /\bget\b/i.test(a.textContent ?? "")) ??
    anchors.find((a) => /get\.php\?/i.test(a.getAttribute("href") ?? ""));
  const href = get?.getAttribute("href");
  if (!href) return null;
  if (/^https?:/i.test(href)) return href;
  return `${base}/${href.replace(/^\//, "")}`;
}

// Resolve a result's direct download URL by trying ads.php on each mirror.
export async function resolveDownloadUrl(
  result: LibgenResult,
  signal?: AbortSignal,
): Promise<string> {
  for (const base of MIRRORS) {
    try {
      const html = await fetchText(`${base}/ads.php?md5=${result.md5}`, 15000, signal);
      const url = extractDownloadUrl(html, base);
      if (url) return url;
    } catch (e) {
      logger.warn("books/libgen", "download page failed", {
        base,
        err: e instanceof Error ? e.message : String(e),
      });
    }
  }
  throw new Error("Couldn't resolve a download link from any mirror.");
}

/** Progress callback: received bytes + total (null when Content-Length absent). */
export type DownloadProgress = (received: number, total: number | null) => void;

// Fetch the actual file bytes (streamed so we can report progress), plus the
// filename to persist it under.
export async function downloadLibgenBook(
  result: LibgenResult,
  onProgress?: DownloadProgress,
  signal?: AbortSignal,
): Promise<{ bytes: Uint8Array; filename: string }> {
  const url = await resolveDownloadUrl(result, signal);
  const res = await tauriFetch(url, {
    method: "GET",
    headers: { "User-Agent": UA },
    connectTimeout: 30000,
    signal,
  });
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);

  const lenHeader = res.headers.get("content-length");
  const total = lenHeader ? parseInt(lenHeader, 10) || null : null;

  let bytes: Uint8Array;
  if (res.body && typeof res.body.getReader === "function") {
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    onProgress?.(0, total);
    for (;;) {
      if (signal?.aborted) {
        await reader.cancel().catch(() => {});
        throw new DOMException("Download cancelled", "AbortError");
      }
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        received += value.byteLength;
        onProgress?.(received, total);
      }
    }
    bytes = new Uint8Array(received);
    let off = 0;
    for (const c of chunks) {
      bytes.set(c, off);
      off += c.byteLength;
    }
  } else {
    bytes = new Uint8Array(await res.arrayBuffer());
    onProgress?.(bytes.byteLength, total ?? bytes.byteLength);
  }

  if (bytes.byteLength === 0) throw new Error("Downloaded file was empty.");
  return { bytes, filename: suggestFilename(result) };
}

function suggestFilename(result: LibgenResult): string {
  const base = `${result.authors[0] ? result.authors[0] + " - " : ""}${result.title}`
    .replace(/[/\\?%*:|"<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  const ext =
    result.extension && result.extension !== "unknown" ? result.extension : "epub";
  return `${base || result.md5}.${ext}`;
}
