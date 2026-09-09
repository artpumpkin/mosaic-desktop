// Stremio's OpenSubtitles v3 addon: free, no key.
//   GET /subtitles/{type}/{id}.json
//      { subtitles: [{ id, url, lang }] }
//
// Subtitle URLs point at .srt files. <video><track> requires WebVTT, so we
// convert on the fly (small inline parser, no extra dep).

import { fetchJsonCached } from "./cache";
import type { ContentType, Subtitle } from "./types";

const BASE = "https://opensubtitles-v3.strem.io";
const TTL_MS = 24 * 60 * 60 * 1000; // 24h

export async function fetchSubtitles(
  type: ContentType,
  id: string, // "ttXXXXXXX" or "ttXXXXXXX:S:E"
): Promise<Subtitle[]> {
  const url = `${BASE}/subtitles/${type}/${id}.json`;
  try {
    const json = await fetchJsonCached<{ subtitles?: Subtitle[] }>(url, TTL_MS);
    return json.subtitles ?? [];
  } catch {
    return [];
  }
}

// Minimal SRT → WebVTT converter. SRT timestamp is HH:MM:SS,mmm; VTT uses
// HH:MM:SS.mmm. Cue numbering is allowed in VTT, so we keep it. Stremio's
// OpenSubtitles always serves UTF-8 SRT — we don't try to handle other
// encodings here.
export function srtToVtt(srt: string): string {
  const body = srt
    .replace(/\r+/g, "")
    .replace(/(\d\d:\d\d:\d\d),(\d{3})/g, "$1.$2");
  return `WEBVTT\n\n${body.trim()}\n`;
}

// Convert SRT URL → blob: URL we can hand to <track src=…>. WebKit cares
// about Content-Type, so we go via Blob rather than data:.
export async function loadSubtitleAsVttBlob(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`subtitle fetch ${res.status}`);
  const text = await res.text();
  const vtt = srtToVtt(text);
  const blob = new Blob([vtt], { type: "text/vtt" });
  return URL.createObjectURL(blob);
}

// Human-readable language label. We map a small set; everything else falls
// back to the ISO code uppercased.
const LANG_LABELS: Record<string, string> = {
  eng: "English",
  fre: "French",
  fra: "French",
  spa: "Spanish",
  por: "Portuguese",
  ger: "German",
  deu: "German",
  ita: "Italian",
  rus: "Russian",
  ara: "Arabic",
  chi: "Chinese",
  zho: "Chinese",
  jpn: "Japanese",
  kor: "Korean",
  hin: "Hindi",
  tur: "Turkish",
  dut: "Dutch",
  nld: "Dutch",
  pol: "Polish",
  swe: "Swedish",
};

export function langLabel(code: string): string {
  return LANG_LABELS[code.toLowerCase()] ?? code.toUpperCase();
}
