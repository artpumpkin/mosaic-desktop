// Unified play-progress for the Audio hub (podcast episodes + Audius music),
// used to feed the Dashboard "Up next" rail. The podcast resume-position store
// (lib/podcasts/library.ts) stays the source of truth for *resuming*; this is a
// thin, display-oriented log keyed by item id that also carries title/art so a
// continue card can render without re-fetching. localStorage, client-only.

const PROGRESS_KEY = "mosaic.audio.progress";

export type AudioProgress = {
  key: string; // audio item id (episode guid / Audius track id)
  kind: "podcast" | "music";
  title: string;
  artist: string | null;
  cover: string | null;
  position: number; // seconds
  duration: number; // seconds
  updatedAt: number; // epoch ms — stamped on write
};

// The fields a caller supplies; updatedAt is stamped here so callers (React
// components) never reach for Date.now() during render/effects.
export type AudioProgressInput = Omit<AudioProgress, "updatedAt">;

type ProgressMap = Record<string, AudioProgress>;

function read(): ProgressMap {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as ProgressMap) : {};
  } catch {
    return {};
  }
}

export function saveAudioProgress(p: AudioProgressInput) {
  if (!p.duration || p.duration < 30) return;
  const map = read();
  // Near the end → drop so a finished item doesn't linger in "Up next".
  if (p.position >= p.duration - 20) {
    delete map[p.key];
  } else {
    map[p.key] = { ...p, updatedAt: Date.now() };
  }
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(map));
  } catch {
    /* ignore quota */
  }
}

// Throttle timeupdate writes (mirrors lib/podcasts/library's throttledEpisodeSaver).
export function throttledAudioSaver(intervalMs: number) {
  let last = 0;
  return (p: AudioProgressInput) => {
    const now = Date.now();
    if (now - last < intervalMs) return;
    last = now;
    saveAudioProgress(p);
  };
}

export function listInProgress(): AudioProgress[] {
  return Object.values(read()).sort((a, b) => b.updatedAt - a.updatedAt);
}
