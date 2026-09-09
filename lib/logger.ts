// Lightweight in-app logger for debugging playback / torrent issues. Writes
// to both a bounded ring buffer (so the user can pop a panel open and copy
// the recent activity) and to console.* so DevTools / Tauri stdout still
// shows everything live.
//
// Usage:
//   import { logger } from "@/lib/logger";
//   logger.info("movies/player", "stream-resolve start", { infoHash, fileIdx });
//   logger.error("movies/player", "torrent_start failed", { msg });
//
// The bug panel in MoviePlayer reads from `getAll()` and subscribes via
// `subscribe()` so new entries stream in live while it's open.

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogEntry = {
  ts: number;
  level: LogLevel;
  source: string;
  msg: string;
  ctx?: Record<string, unknown>;
};

const MAX_ENTRIES = 500;

const ring: LogEntry[] = [];
const listeners = new Set<() => void>();

function emit(entry: LogEntry) {
  ring.push(entry);
  if (ring.length > MAX_ENTRIES) ring.splice(0, ring.length - MAX_ENTRIES);
  for (const l of listeners) {
    try {
      l();
    } catch {
      /* ignore */
    }
  }
  // Mirror to console so DevTools / Tauri stdout still has it.
  const tag = `[${entry.source}]`;
  switch (entry.level) {
    case "debug":
      // eslint-disable-next-line no-console
      console.debug(tag, entry.msg, entry.ctx ?? "");
      break;
    case "info":
      // eslint-disable-next-line no-console
      console.info(tag, entry.msg, entry.ctx ?? "");
      break;
    case "warn":
      // eslint-disable-next-line no-console
      console.warn(tag, entry.msg, entry.ctx ?? "");
      break;
    case "error":
      // eslint-disable-next-line no-console
      console.error(tag, entry.msg, entry.ctx ?? "");
      break;
  }
}

function make(level: LogLevel) {
  return (source: string, msg: string, ctx?: Record<string, unknown>) =>
    emit({ ts: Date.now(), level, source, msg, ctx });
}

export const logger = {
  debug: make("debug"),
  info: make("info"),
  warn: make("warn"),
  error: make("error"),

  getAll(): LogEntry[] {
    return ring.slice();
  },

  clear() {
    ring.length = 0;
    for (const l of listeners) {
      try {
        l();
      } catch {
        /* ignore */
      }
    }
  },

  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};

// Format a single entry as one line of text for the copy-to-clipboard flow.
export function formatEntry(e: LogEntry): string {
  const d = new Date(e.ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  const time = `${hh}:${mm}:${ss}.${ms}`;
  const lvl = e.level.toUpperCase().padEnd(5);
  const ctx = e.ctx && Object.keys(e.ctx).length > 0 ? " " + safeStringify(e.ctx) : "";
  return `[${time}] [${lvl}] [${e.source}] ${e.msg}${ctx}`;
}

// JSON.stringify that gracefully degrades on cyclic refs / huge blobs.
function safeStringify(obj: unknown): string {
  try {
    return JSON.stringify(obj, (_k, v) => {
      if (typeof v === "string" && v.length > 200) return v.slice(0, 200) + "…";
      return v;
    });
  } catch {
    return String(obj);
  }
}

export function exportAll(): string {
  return ring.map(formatEntry).join("\n");
}
