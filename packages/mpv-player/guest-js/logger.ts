// Injectable logger for the player package.
//
// The package ships a self-contained ring-buffer logger so it works
// with zero wiring (MpvDebugPanel reads `getAll()` / `subscribe()`).
// A host app can call `setLogger(myLogger)` once at startup to funnel
// the player's logs into its own logging system for a unified view.
//
// `logger` is a stable proxy that forwards to whichever logger is
// active, so modules that captured `logger` at import time still hit the
// injected one after `setLogger`.

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogEntry = {
  ts: number;
  level: LogLevel;
  source: string;
  msg: string;
  ctx?: Record<string, unknown>;
};

export interface PlayerLogger {
  debug(source: string, msg: string, ctx?: Record<string, unknown>): void;
  info(source: string, msg: string, ctx?: Record<string, unknown>): void;
  warn(source: string, msg: string, ctx?: Record<string, unknown>): void;
  error(source: string, msg: string, ctx?: Record<string, unknown>): void;
  getAll(): LogEntry[];
  subscribe(fn: () => void): () => void;
  clear(): void;
}

const MAX_ENTRIES = 500;

// Console-mirroring toggle. Default OFF so a production consumer doesn't
// get debug/info spam in their devtools for every player action. The
// in-memory ring buffer always records (it's cheap + bounded, and powers
// MpvDebugPanel), but only `warn`/`error` reach the console unless a
// consumer opts in via `setPlayerDebug(true)`. Errors/warnings are always
// mirrored — those are real problems worth surfacing regardless.
let consoleMirror = false;

/** Enable/disable verbose console mirroring of player logs (debug + info).
 *  Off by default; `warn`/`error` are always shown. Call once at startup
 *  (e.g. behind your app's own debug flag) to get a live console trace. */
export function setPlayerDebug(enabled: boolean): void {
  consoleMirror = enabled;
}

/** Current console-mirroring state (mainly for tests / introspection). */
export function isPlayerDebug(): boolean {
  return consoleMirror;
}

function createDefaultLogger(): PlayerLogger {
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
    // Mirror to console so DevTools / Tauri stdout still has it. debug/info
    // only when the consumer opted in (see consoleMirror); warn/error always.
    const tag = `[${entry.source}]`;
    switch (entry.level) {
      case "debug":
        // eslint-disable-next-line no-console
        if (consoleMirror) console.debug(tag, entry.msg, entry.ctx ?? "");
        break;
      case "info":
        // eslint-disable-next-line no-console
        if (consoleMirror) console.info(tag, entry.msg, entry.ctx ?? "");
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

  const make =
    (level: LogLevel) =>
    (source: string, msg: string, ctx?: Record<string, unknown>) =>
      emit({ ts: Date.now(), level, source, msg, ctx });

  return {
    debug: make("debug"),
    info: make("info"),
    warn: make("warn"),
    error: make("error"),
    getAll: () => ring.slice(),
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
}

let active: PlayerLogger = createDefaultLogger();

/** Replace the package's built-in logger with the host app's. Call once
 *  at startup. Pass any object implementing `PlayerLogger`. */
export function setLogger(l: PlayerLogger): void {
  active = l;
}

/** Stable proxy used throughout the package — forwards to whichever
 *  logger is active (built-in by default, host-injected after
 *  `setLogger`). */
export const logger: PlayerLogger = {
  debug: (s, m, c) => active.debug(s, m, c),
  info: (s, m, c) => active.info(s, m, c),
  warn: (s, m, c) => active.warn(s, m, c),
  error: (s, m, c) => active.error(s, m, c),
  getAll: () => active.getAll(),
  subscribe: (fn) => active.subscribe(fn),
  clear: () => active.clear(),
};

// Format a single entry as one line of text for the copy-to-clipboard
// flow in MpvDebugPanel.
export function formatEntry(e: LogEntry): string {
  const d = new Date(e.ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  const time = `${hh}:${mm}:${ss}.${ms}`;
  const lvl = e.level.toUpperCase().padEnd(5);
  const ctx =
    e.ctx && Object.keys(e.ctx).length > 0 ? " " + safeStringify(e.ctx) : "";
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
