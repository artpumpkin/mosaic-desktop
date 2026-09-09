// Player-specific debug helpers — action timing + UI FPS measurement.
//
// `trackAction` wraps a promise-returning user action with start +
// completion logging AND a separate ring buffer of actions (vs. the
// general log ring). The dedicated buffer makes it cheap for the debug
// panel to show "the last N things the user did and how long each
// took" without sifting through 500 generic log entries.
//
// `useUiFps` is a small hook that yields the current animation-frame
// rate, useful to spot React render hitches (separate from mpv's
// internal playback fps, which would require a Rust-side
// `get_property` bridge we don't have yet).
//
// Why a separate module: keeps PlayerControls / MpvDebugPanel /
// useMpvHotkeys importing the same helper, so action timing happens
// consistently across click handlers, keyboard handlers, and any
// future programmatic call sites.

"use client";

import { useEffect, useRef, useState } from "react";
import { logger } from "./logger";

export type PlayerAction = {
  id: number;
  ts: number;
  label: string;
  ctx: Record<string, unknown>;
  durationMs: number | null; // null = still in flight
  ok: boolean | null; // null = pending, true = resolved, false = rejected
  error?: string;
};

const ACTIONS_MAX = 80;

// Defense against module duplication: in some bundler configurations
// (HMR boundaries, mixed server/client graphs) the same module file
// can be evaluated twice, producing two independent `ring` arrays.
// Writers would target one and readers the other, and the actions
// section of the debug dump would silently come up empty (this is the
// bug we hit in dump #1). Storing the singleton on `globalThis` under
// a unique key keeps all evaluations pointing at the same ring.
export type FpsSample = {
  ts: number;
  fps: number;
  /** Longest gap between consecutive rAF callbacks during this sample
   *  window, in ms. A 60fps sample with maxGapMs=200 means most frames
   *  fired on time but one was very late — averaging would have hidden
   *  that hitch. Useful signal when fps looks fine but feels janky. */
  maxGapMs: number;
};

export type LongTask = {
  ts: number;        // wall-clock at task end
  durationMs: number;
  /** Optional name hint (set when triggered via measureSection). */
  name?: string;
};

const FPS_HISTORY_MAX = 120; // ~60s of history at 500ms sample interval
const LONGTASK_MAX = 80;

type Store = {
  ring: PlayerAction[];
  subs: Set<() => void>;
  nextId: number;
  // FPS history is also stored on the same globalThis-backed singleton
  // so the dump and any consumer can see the same data even if the
  // module gets duplicated.
  fps: FpsSample[];
  fpsSubs: Set<() => void>;
  longTasks: LongTask[];
  longTaskSubs: Set<() => void>;
  longTaskObserverStarted: boolean;
};
const STORE_KEY = "__mosaicPlayerActionStore" as const;
type GlobalWithStore = typeof globalThis & { [STORE_KEY]?: Store };

function store(): Store {
  const g = globalThis as GlobalWithStore;
  if (!g[STORE_KEY]) {
    g[STORE_KEY] = {
      ring: [],
      subs: new Set(),
      nextId: 1,
      fps: [],
      fpsSubs: new Set(),
      longTasks: [],
      longTaskSubs: new Set(),
      longTaskObserverStarted: false,
    };
  }
  return g[STORE_KEY];
}

// ---------------------------------------------------------------
// Long Tasks — the canonical signal for "what just blocked the main
// thread". The browser's PerformanceObserver reports any task that
// took >50ms to execute, including the start time. We correlate the
// timestamps with the action ring to identify which user interaction
// (or background event) caused the hitch.
// ---------------------------------------------------------------

function pushLongTask(t: LongTask) {
  const s = store();
  s.longTasks.push(t);
  if (s.longTasks.length > LONGTASK_MAX) {
    s.longTasks.splice(0, s.longTasks.length - LONGTASK_MAX);
  }
  for (const fn of s.longTaskSubs) {
    try { fn(); } catch { /* ignore */ }
  }
}

export function startLongTaskObserver(): void {
  if (typeof window === "undefined") return;
  const s = store();
  if (s.longTaskObserverStarted) return;
  // Some webviews don't implement PerformanceObserver / 'longtask'.
  // Guard everything and silently no-op.
  const POAny = (window as unknown as {
    PerformanceObserver?: {
      new (cb: (list: { getEntries: () => PerformanceEntry[] }) => void): {
        observe: (init: { entryTypes?: string[]; type?: string }) => void;
        disconnect: () => void;
      };
      supportedEntryTypes?: string[];
    };
  }).PerformanceObserver;
  if (!POAny) return;
  const supports = POAny.supportedEntryTypes;
  if (supports && !supports.includes("longtask")) return;
  try {
    const obs = new POAny((list) => {
      for (const entry of list.getEntries()) {
        // entry.startTime is a DOMHighResTimeStamp relative to
        // performance.timeOrigin. Convert to wall-clock for easy
        // correlation with action timestamps.
        const endHighRes = entry.startTime + entry.duration;
        const wallEnd = performance.timeOrigin + endHighRes;
        pushLongTask({
          ts: wallEnd,
          durationMs: Math.round(entry.duration),
          name: entry.name === "self" ? undefined : entry.name,
        });
      }
    });
    obs.observe({ entryTypes: ["longtask"] });
    s.longTaskObserverStarted = true;
  } catch {
    /* unsupported — no-op */
  }
}

export function getLongTasks(): LongTask[] {
  return store().longTasks.slice();
}

export function subscribeLongTasks(fn: () => void): () => void {
  const s = store();
  s.longTaskSubs.add(fn);
  return () => {
    s.longTaskSubs.delete(fn);
  };
}

export function formatLongTask(t: LongTask): string {
  const d = new Date(t.ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  const time = `${hh}:${mm}:${ss}.${ms}`;
  const tag =
    t.durationMs >= 200
      ? "BLOCK"
      : t.durationMs >= 100
        ? "long"
        : "slow";
  return `[${time}] ${String(t.durationMs).padStart(4)}ms  ${tag}${
    t.name ? `  ${t.name}` : ""
  }`;
}

// Public helper: mark a code block with `performance.measure` so its
// duration shows up alongside long tasks. Useful for instrumenting
// suspected hot paths.
export function measureSection<T>(name: string, fn: () => T): T {
  if (typeof performance === "undefined" || !performance.mark) return fn();
  const startMark = `${name}-start`;
  performance.mark(startMark);
  try {
    return fn();
  } finally {
    try {
      performance.measure(name, startMark);
    } catch {
      /* ignore measurement errors */
    }
  }
}

function notify() {
  const s = store();
  for (const fn of s.subs) {
    try {
      fn();
    } catch {
      /* ignore */
    }
  }
}

function record(a: PlayerAction) {
  const s = store();
  s.ring.push(a);
  if (s.ring.length > ACTIONS_MAX) s.ring.splice(0, s.ring.length - ACTIONS_MAX);
  notify();
}

function update(id: number, patch: Partial<PlayerAction>) {
  const s = store();
  const i = s.ring.findIndex((a) => a.id === id);
  if (i < 0) return;
  s.ring[i] = { ...s.ring[i], ...patch };
  notify();
}

/**
 * Wrap a user action: log "action: <label>" at start, log
 * "action done: <label>" with duration on resolution, and record both
 * events into the action ring buffer so the debug dump has a clean
 * timeline of "what the user clicked and how long each step took".
 *
 * Designed to be a drop-in replacement for the previous `act()`
 * helper in PlayerControls.
 */
export function trackAction<T>(
  label: string,
  ctx: Record<string, unknown>,
  p: Promise<T>,
): Promise<T> {
  const s = store();
  const id = s.nextId++;
  const startedAt = performance.now();
  const wallTs = Date.now();
  record({
    id,
    ts: wallTs,
    label,
    ctx,
    durationMs: null,
    ok: null,
  });
  logger.info("player/action", `start: ${label}`, ctx);
  return p
    .then((v) => {
      const dur = Math.round(performance.now() - startedAt);
      update(id, { durationMs: dur, ok: true });
      logger.info("player/action", `done: ${label}`, { ms: dur, ...ctx });
      return v;
    })
    .catch((err) => {
      const dur = Math.round(performance.now() - startedAt);
      const msg = err instanceof Error ? err.message : String(err);
      update(id, { durationMs: dur, ok: false, error: msg });
      logger.warn("player/action", `fail: ${label}`, { ms: dur, err: msg, ...ctx });
      throw err;
    });
}

/** Read the current action ring (newest last). */
export function getActions(): PlayerAction[] {
  return store().ring.slice();
}

/** Subscribe to action ring changes. Returns an unsubscribe fn. */
export function subscribeActions(fn: () => void): () => void {
  const s = store();
  s.subs.add(fn);
  return () => {
    s.subs.delete(fn);
  };
}

/** Format one action as a single line for the debug dump. */
export function formatAction(a: PlayerAction): string {
  const t = new Date(a.ts);
  const hh = String(t.getHours()).padStart(2, "0");
  const mm = String(t.getMinutes()).padStart(2, "0");
  const ss = String(t.getSeconds()).padStart(2, "0");
  const ms = String(t.getMilliseconds()).padStart(3, "0");
  const time = `${hh}:${mm}:${ss}.${ms}`;
  const status =
    a.ok == null ? "…" : a.ok ? `${a.durationMs}ms` : `FAIL ${a.durationMs}ms`;
  const ctx =
    a.ctx && Object.keys(a.ctx).length
      ? " " + JSON.stringify(a.ctx)
      : "";
  const err = a.error ? `  err=${a.error}` : "";
  return `[${time}] ${a.label.padEnd(20)} ${status}${ctx}${err}`;
}

// ---------------------------------------------------------------
// UI FPS: counts how many requestAnimationFrame callbacks fire per
// second. Drops below 60 mean the React/webview side is hitching —
// independent from mpv's video pacing.
//
// Each sample is also pushed to a shared history ring so the debug
// dump shows "here's what fps was doing for the last minute, line up
// the timestamps with the actions list to find what caused the drop".
// ---------------------------------------------------------------

function pushFpsSample(fps: number, maxGapMs: number) {
  const s = store();
  s.fps.push({ ts: Date.now(), fps, maxGapMs });
  if (s.fps.length > FPS_HISTORY_MAX) {
    s.fps.splice(0, s.fps.length - FPS_HISTORY_MAX);
  }
  for (const fn of s.fpsSubs) {
    try {
      fn();
    } catch {
      /* ignore */
    }
  }
}

export function getFpsHistory(): FpsSample[] {
  return store().fps.slice();
}

export function subscribeFps(fn: () => void): () => void {
  const s = store();
  s.fpsSubs.add(fn);
  return () => {
    s.fpsSubs.delete(fn);
  };
}

export function useUiFps(enabled = true): number {
  const [fps, setFps] = useState(0);
  const framesRef = useRef(0);
  const lastTsRef = useRef(0);
  const lastFrameRef = useRef(0);
  const maxGapRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const now0 = performance.now();
    lastTsRef.current = now0;
    lastFrameRef.current = now0;
    maxGapRef.current = 0;

    const tick = (now: number) => {
      framesRef.current++;
      // Track largest gap between consecutive rAFs this window. The
      // dump includes this alongside fps so a perfectly-averaged
      // sample with one huge stall still reveals the stall.
      if (lastFrameRef.current > 0) {
        const gap = now - lastFrameRef.current;
        if (gap > maxGapRef.current) maxGapRef.current = gap;
      }
      lastFrameRef.current = now;
      const dt = now - lastTsRef.current;
      // Sample every ~500ms — enough to react to hitches without
      // re-rendering the panel at 60Hz.
      if (dt >= 500) {
        const sample = Math.round((framesRef.current * 1000) / dt);
        setFps(sample);
        pushFpsSample(sample, Math.round(maxGapRef.current));
        framesRef.current = 0;
        maxGapRef.current = 0;
        lastTsRef.current = now;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [enabled]);

  return fps;
}

/** Format one FPS sample for the dump (matches action timestamps). */
export function formatFpsSample(s: FpsSample): string {
  const t = new Date(s.ts);
  const hh = String(t.getHours()).padStart(2, "0");
  const mm = String(t.getMinutes()).padStart(2, "0");
  const ss = String(t.getSeconds()).padStart(2, "0");
  const ms = String(t.getMilliseconds()).padStart(3, "0");
  const tag = s.fps >= 55 ? "ok" : s.fps >= 30 ? "low" : "BAD";
  const gapTag =
    s.maxGapMs >= 100 ? "  ⚠HITCH" : s.maxGapMs >= 33 ? "  (skip)" : "";
  return `[${hh}:${mm}:${ss}.${ms}] ${String(s.fps).padStart(3)}fps  ${tag}  gap=${String(
    s.maxGapMs,
  ).padStart(3)}ms${gapTag}`;
}
