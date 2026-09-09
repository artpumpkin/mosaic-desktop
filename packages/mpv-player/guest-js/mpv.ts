// Thin typed wrapper around the `tauri-plugin-mpv-player` Rust backend.
// Commands are invoked as `plugin:mpv-player|<cmd>`; events arrive as
// `mpv:state` / `mpv:tracks` / `mpv:buffer` / `mpv:eof`.
//
// Why a small handle object rather than free functions: call sites want
// to do `handle.play()` / `handle.seek(t)` etc. on a ref, same as they
// would against `videoRef.current` on an HTML5 `<video>` element.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { logger } from "./logger";

export type MpvState = {
  time_pos: number | null;
  duration: number | null;
  paused: boolean | null;
  volume: number | null;
  muted: boolean | null;
  eof: boolean;
};

// Volume ceiling used by BOTH the slider UI and the keyboard shortcuts.
// mpv itself allows boosting above 100 (soft gain), but the slider track
// maps 0–100, so the keyboard path used to be able to push volume to a
// value the slider couldn't represent (showed 100, snapped back on next
// drag). Sharing one constant keeps the two input paths consistent.
export const VOLUME_MAX = 100;

// Version of THIS guest-js bundle. The literal token is replaced at
// build time by the `inject-player-version` rollup plugin with the
// package.json version. If you ever see the raw token in the UI, the
// app is running an unbuilt/dev copy of the bundle.
export const PLAYER_VERSION = "__PLAYER_VERSION__";

// Native plugin build stamp, as returned by `attach`. `buildUnix` is the
// compile time baked into the Rust binary — the definitive signal for
// whether the NATIVE side was actually rebuilt (a webview reload swaps JS
// but not Rust).
export type MpvVersion = {
  /** Native plugin crate version (`CARGO_PKG_VERSION`). */
  plugin: string;
  /** Guest-js bundle version (this package). */
  player: string;
  /** Unix seconds the native binary was compiled (0 if unknown). */
  buildUnix: number;
};

// Wire shape of attach's return value (snake_case, per src/models.rs).
type NativeVersionWire = { plugin: string; build_unix: number };

// Cached once on the first successful attach; read synchronously by the
// debug panel so the dump can include it without an await.
let nativeVersion: { plugin: string; buildUnix: number } | null = null;

export type MpvBounds = { x: number; y: number; w: number; h: number };

export type MpvHandle = {
  attach: (windowLabel?: string) => Promise<void>;
  setBounds: (bounds: MpvBounds) => Promise<void>;
  load: (url: string, opts?: { autoplay?: boolean }) => Promise<void>;
  play: () => Promise<void>;
  pause: () => Promise<void>;
  seek: (seconds: number, mode?: "absolute" | "relative") => Promise<void>;
  setProperty: (name: string, value: string | number | boolean) => Promise<void>;
  command: (name: string, args?: string[]) => Promise<void>;
  stop: () => Promise<void>;
  /** Toggle the Tauri window's fullscreen state. mpv's own
   *  `fullscreen` property does nothing under vo=libmpv (we own the
   *  surface, mpv doesn't have a window), so the player's fullscreen
   *  affordance must drive the host window instead. */
  toggleFullscreen: () => Promise<void>;

  /** Build stamp of the running native + JS builds. Returns null until
   *  the first `attach` resolves (the native half arrives with it). */
  getVersion: () => MpvVersion | null;

  onState: (cb: (s: MpvState) => void) => () => void;
  onTracks: (cb: (tracksJson: string) => void) => () => void;
  onBuffer: (cb: (bufferJson: string) => void) => () => void;
  onEof: (cb: (reason: string) => void) => () => void;
};

// Module-singleton handle. The Rust side enforces a single attached
// instance process-wide, so it doesn't make sense to hand out multiple
// JS handles — they'd all proxy to the same controller. Subscribers
// share the same event listeners; we only attach the Tauri listener
// once per event channel.
let attachPromise: Promise<void> | null = null;
let stateUnlisten: UnlistenFn | null = null;
let tracksUnlisten: UnlistenFn | null = null;
let bufferUnlisten: UnlistenFn | null = null;
let eofUnlisten: UnlistenFn | null = null;

const stateSubs = new Set<(s: MpvState) => void>();
const trackSubs = new Set<(j: string) => void>();
const bufferSubs = new Set<(j: string) => void>();
const eofSubs = new Set<(r: string) => void>();

// Event-rate counters: count how many of each event type we've
// received from the Rust side. Exposed via getEventCounts() for the
// debug dump. Lets us see if a "quiet" period (no visible UI work)
// is actually being flooded by state echoes from libmpv.
type EventCounts = {
  state: number;
  tracks: number;
  buffer: number;
  eof: number;
  startedAt: number;
};
const _counts: EventCounts = {
  state: 0,
  tracks: 0,
  buffer: 0,
  eof: 0,
  startedAt: typeof performance !== "undefined" ? performance.now() : 0,
};
export function getEventCounts() {
  const now = typeof performance !== "undefined" ? performance.now() : 0;
  const elapsedSec = Math.max(0.001, (now - _counts.startedAt) / 1000);
  return {
    ...{ state: _counts.state, tracks: _counts.tracks, buffer: _counts.buffer, eof: _counts.eof },
    elapsedSec: Math.round(elapsedSec * 10) / 10,
    stateHz: Math.round((_counts.state / elapsedSec) * 10) / 10,
    tracksHz: Math.round((_counts.tracks / elapsedSec) * 10) / 10,
    bufferHz: Math.round((_counts.buffer / elapsedSec) * 10) / 10,
  };
}

// rAF-coalesced dispatch state. mpv (Rust side) can emit events in
// tight bursts — especially after a flurry of `setProperty` calls
// where each one echoes back AND mpv sometimes emits multiple events
// per single property change (downstream effects, observer fan-out).
// Firing every subscriber synchronously for each of those events is
// what was tanking ui fps to 2-11 after a drag. We store the latest
// payload and fire subscribers once per animation frame regardless of
// how many events arrived in between.
let pendingState: MpvState | null = null;
let stateRaf: number | null = null;
let pendingTracks: string | null = null;
let tracksRaf: number | null = null;
let pendingBuffer: string | null = null;
let bufferRaf: number | null = null;

// Threshold for warning about a slow subscriber dispatch. 16ms is one
// 60Hz frame; if a dispatch eats more than that we'll see it in the
// debug log + can correlate against the action timeline.
const SUBSCRIBER_WARN_MS = 16;

function scheduleStateDispatch() {
  if (stateRaf != null) return;
  stateRaf = requestAnimationFrame(() => {
    stateRaf = null;
    const s = pendingState;
    pendingState = null;
    if (s != null) {
      const t0 = performance.now();
      for (const cb of stateSubs) cb(s);
      const dt = performance.now() - t0;
      if (dt > SUBSCRIBER_WARN_MS) {
        logger.warn("player/mpv", "slow state dispatch", {
          ms: Math.round(dt),
          subs: stateSubs.size,
        });
      }
    }
  });
}

function scheduleTracksDispatch() {
  if (tracksRaf != null) return;
  tracksRaf = requestAnimationFrame(() => {
    tracksRaf = null;
    const j = pendingTracks;
    pendingTracks = null;
    if (j != null) {
      for (const cb of trackSubs) cb(j);
    }
  });
}

function scheduleBufferDispatch() {
  if (bufferRaf != null) return;
  bufferRaf = requestAnimationFrame(() => {
    bufferRaf = null;
    const j = pendingBuffer;
    pendingBuffer = null;
    if (j != null) {
      for (const cb of bufferSubs) cb(j);
    }
  });
}

async function ensureListeners() {
  if (!stateUnlisten) {
    stateUnlisten = await listen<MpvState>("mpv:state", (e) => {
      _counts.state++;
      // Coalesce: only the latest payload survives until the next rAF
      // dispatch. A burst of N events becomes 1 subscriber pass.
      pendingState = e.payload;
      scheduleStateDispatch();
    });
  }
  if (!tracksUnlisten) {
    tracksUnlisten = await listen<string>("mpv:tracks", (e) => {
      _counts.tracks++;
      // tracks comes in bursts during load (3 events in <100ms in our
      // dumps); only the final one represents the actual track list.
      pendingTracks = e.payload;
      scheduleTracksDispatch();
    });
  }
  if (!bufferUnlisten) {
    bufferUnlisten = await listen<string>("mpv:buffer", (e) => {
      _counts.buffer++;
      pendingBuffer = e.payload;
      scheduleBufferDispatch();
    });
  }
  if (!eofUnlisten) {
    // EOF is singular and rare — dispatch immediately + log.
    eofUnlisten = await listen<string>("mpv:eof", (e) => {
      _counts.eof++;
      logger.info("player/mpv", "eof", { reason: e.payload });
      for (const cb of eofSubs) cb(e.payload);
    });
  }
}

export const mpv: MpvHandle = {
  async attach(windowLabel) {
    if (!attachPromise) {
      attachPromise = (async () => {
        await ensureListeners();
        const v = await invoke<NativeVersionWire>("plugin:mpv-player|attach", {
          windowLabel,
        });
        // Cache the native build stamp + log it next to the JS version so
        // a single "attached" line in the dump proves both halves.
        if (v && typeof v.plugin === "string") {
          nativeVersion = { plugin: v.plugin, buildUnix: v.build_unix ?? 0 };
        } else {
          // Attached, but the native side returned no version — it predates
          // this feature, i.e. the Rust binary was NOT rebuilt. Surface it
          // loudly rather than falling back to a blank.
          nativeVersion = { plugin: "unknown (stale native)", buildUnix: 0 };
        }
        logger.info("player/mpv", "attached", {
          windowLabel,
          plugin: nativeVersion?.plugin,
          player: PLAYER_VERSION,
          buildUnix: nativeVersion?.buildUnix,
        });
      })().catch((err) => {
        // Reset on failure so a retry can happen.
        attachPromise = null;
        throw err;
      });
    }
    return attachPromise;
  },
  async setBounds(bounds) {
    await invoke("plugin:mpv-player|set_bounds", { bounds });
  },
  async load(url, opts) {
    const autoplay = opts?.autoplay ?? true;
    logger.info("player/mpv", "load", { url, autoplay });
    // Optimistically reset the transient position/duration so the PREVIOUS
    // file's "1:23 / 5:00" and filled scrubber don't linger while the new
    // file demuxes. duration:0 flips the controls to their not-ready
    // (loading) state until mpv reports real metadata. paused/volume/muted
    // are left null (ignored by subscribers) so we don't flash a spurious
    // play/pause feedback or reset the volume readout. Routed through the
    // same rAF dispatch as real events so ordering is consistent.
    pendingState = {
      time_pos: 0,
      duration: 0,
      paused: null,
      volume: null,
      muted: null,
      eof: false,
    };
    scheduleStateDispatch();
    await invoke("plugin:mpv-player|load", { url, autoplay });
  },
  async play() {
    await invoke("plugin:mpv-player|play");
  },
  async pause() {
    await invoke("plugin:mpv-player|pause");
  },
  async seek(seconds, mode = "absolute") {
    await invoke("plugin:mpv-player|seek", { seconds, mode });
  },
  async setProperty(name, value) {
    if (typeof value === "boolean") {
      await invoke("plugin:mpv-player|set_property_bool", { name, value });
    } else if (typeof value === "number") {
      await invoke("plugin:mpv-player|set_property_f64", { name, value });
    } else {
      await invoke("plugin:mpv-player|set_property_str", { name, value });
    }
  },
  async command(name, args = []) {
    await invoke("plugin:mpv-player|command", { name, args });
  },
  async stop() {
    await invoke("plugin:mpv-player|stop");
  },
  async toggleFullscreen() {
    const win = getCurrentWindow();
    const isFs = await win.isFullscreen();
    await win.setFullscreen(!isFs);
  },

  getVersion() {
    if (!nativeVersion) return null;
    return {
      plugin: nativeVersion.plugin,
      player: PLAYER_VERSION,
      buildUnix: nativeVersion.buildUnix,
    };
  },

  onState(cb) {
    stateSubs.add(cb);
    return () => {
      stateSubs.delete(cb);
    };
  },
  onTracks(cb) {
    trackSubs.add(cb);
    return () => {
      trackSubs.delete(cb);
    };
  },
  onBuffer(cb) {
    bufferSubs.add(cb);
    return () => {
      bufferSubs.delete(cb);
    };
  },
  onEof(cb) {
    eofSubs.add(cb);
    return () => {
      eofSubs.delete(cb);
    };
  },
};
