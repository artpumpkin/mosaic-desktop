// Local music library: the chosen folder + a cached track list (so the page
// renders instantly on revisit without re-scanning), plus the scan invocation.
// The scan itself runs in Rust (ffprobe per file); see src-tauri/src/audio.rs.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AudioTrack } from "./types";

const DIR_KEY = "mosaic.music.libraryDir";
const TRACKS_KEY = "mosaic.music.tracks";

// Real-time scan progress, emitted from src-tauri/src/audio.rs over the
// `audio://scan` event (mirrors the Cleanup section's progress contract).
export interface AudioScanProgress {
  phase: "collecting" | "probing" | "done";
  done: number;
  total: number;
  current: string;
}

// Subscribe to scan progress; returns a Promise of the unlisten fn.
export function onAudioScanProgress(
  cb: (p: AudioScanProgress) => void,
): Promise<() => void> {
  return listen<AudioScanProgress>("audio://scan", (e) => cb(e.payload));
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

export function loadCachedTracks(): AudioTrack[] {
  try {
    const raw = localStorage.getItem(TRACKS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as AudioTrack[]) : [];
  } catch {
    return [];
  }
}

function saveCachedTracks(tracks: AudioTrack[]) {
  try {
    localStorage.setItem(TRACKS_KEY, JSON.stringify(tracks));
  } catch {
    /* quota — re-scan next time */
  }
}

// Scan a folder via the Rust command, persisting the dir + cached results.
export async function scanLibrary(dir: string): Promise<AudioTrack[]> {
  const tracks = await invoke<AudioTrack[]>("audio_scan_library", { dir });
  setLibraryDir(dir);
  saveCachedTracks(tracks);
  return tracks;
}
