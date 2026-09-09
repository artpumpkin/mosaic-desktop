"use client";

// Stremio/VLC-style controls bar for the libmpv-backed player.
//
// Layout:
//   ┌────────────────────────────────────────────────────────────┐
//   │  ━━━━━━━━━○━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │  ← scrubber row
//   │                                                              │
//   │  ⟲ ▶ ⟳  1:23 / 5:00      🔊 ━●━━━   ⚙  CC  🎵  ⛶          │  ← controls row
//   └────────────────────────────────────────────────────────────┘
//
// Tracks (audio + subs) come from mpv's `track-list` property,
// which we re-emit as `mpv:tracks` from Rust. The menus parse it and
// let you switch via `aid` / `sid` properties. Playback speed is
// tracked locally and pushed via `speed` property.
//
// Rendered alongside the video region (not overlaid) — true overlay
// is deferred until we tackle webview transparency.

import { memo, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize2,
  Minimize2,
  Loader2,
  RotateCcw,
  RotateCw,
  Gauge,
  Activity,
  Captions,
  Languages,
  Check,
} from "lucide-react";
import { mpv } from "../mpv";
import { useFullscreen } from "./useFullscreen";
import { trackAction } from "../playerDebug";

// Convenience alias: every user action goes through trackAction so the
// debug panel has a unified timeline of "click → done in N ms".
const act = trackAction;

function formatTime(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return "--:--";
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const ss = (s % 60).toString().padStart(2, "0");
  if (h > 0) return `${h}:${(m % 60).toString().padStart(2, "0")}:${ss}`;
  return `${m}:${ss}`;
}

type Track = {
  id: number;
  type: "video" | "audio" | "sub";
  selected?: boolean;
  lang?: string;
  title?: string;
  codec?: string;
};

function parseTracks(json: string): Track[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return [];
    return arr as Track[];
  } catch {
    return [];
  }
}

function trackLabel(t: Track): string {
  const parts: string[] = [];
  if (t.title) parts.push(t.title);
  else if (t.lang) parts.push(t.lang.toUpperCase());
  else parts.push(`Track ${t.id}`);
  if (t.codec) parts.push(`· ${t.codec}`);
  return parts.join(" ");
}

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

// --- subtitle style -------------------------------------------------
//
// Appearance + sync settings for subtitles, backed by mpv's `sub-*`
// properties. Persisted to localStorage so they survive app restarts,
// and re-applied once the player has a file loaded (mpv's Mpv instance
// is created lazily on `attach`, and `sub-*` options only take visible
// effect while subtitles are rendering).
//
// `sub-ass-override` is the key to making these visible on embedded
// ASS/SSA subtitles (e.g. the multi-track MKV): `force` makes our
// options win over the track's own styling; `scale` is mpv's default
// (only --sub-scale leaks through). Plain SRT/VTT honor the options
// regardless. We flip to `force` whenever any value is non-default and
// back to `scale` on reset.

type SubStyle = {
  size: number; // sub-font-size
  pos: number; // sub-pos (0 = top … 150 = below frame), 100 = default baseline
  delay: number; // sub-delay, seconds (+ = later, − = earlier)
  color: string; // sub-color, #RRGGBB
  outline: string; // sub-outline-color, #RRGGBB
  font: string; // sub-font ("sans-serif" = mpv default)
};

const SUB_STYLE_DEFAULTS: SubStyle = {
  size: 55,
  pos: 100,
  delay: 0,
  color: "#FFFFFF",
  outline: "#000000",
  font: "sans-serif",
};

const SUB_STYLE_KEY = "mpv-player:sub-style";

function loadSubStyle(): SubStyle {
  if (typeof localStorage === "undefined") return { ...SUB_STYLE_DEFAULTS };
  try {
    const raw = localStorage.getItem(SUB_STYLE_KEY);
    if (!raw) return { ...SUB_STYLE_DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<SubStyle>;
    return { ...SUB_STYLE_DEFAULTS, ...parsed };
  } catch {
    return { ...SUB_STYLE_DEFAULTS };
  }
}

function saveSubStyle(style: SubStyle): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(SUB_STYLE_KEY, JSON.stringify(style));
  } catch {
    /* storage disabled / full — non-fatal, settings just won't persist */
  }
}

function isDefaultSubStyle(s: SubStyle): boolean {
  return (
    s.size === SUB_STYLE_DEFAULTS.size &&
    s.pos === SUB_STYLE_DEFAULTS.pos &&
    s.delay === SUB_STYLE_DEFAULTS.delay &&
    s.color.toLowerCase() === SUB_STYLE_DEFAULTS.color.toLowerCase() &&
    s.outline.toLowerCase() === SUB_STYLE_DEFAULTS.outline.toLowerCase() &&
    s.font === SUB_STYLE_DEFAULTS.font
  );
}

// Push the whole style to mpv. Fire-and-forget: a property reject (e.g.
// an unknown name on an older libmpv) shouldn't break the rest.
function applySubStyle(style: SubStyle): void {
  const set = (name: string, value: string | number) =>
    void mpv.setProperty(name, value).catch(() => {});
  set("sub-ass-override", isDefaultSubStyle(style) ? "scale" : "force");
  set("sub-font-size", style.size);
  set("sub-pos", style.pos);
  set("sub-delay", style.delay);
  set("sub-color", style.color);
  set("sub-outline-color", style.outline);
  set("sub-font", style.font);
}

const SUB_FONT_OPTIONS: { label: string; value: string }[] = [
  { label: "Default (sans-serif)", value: "sans-serif" },
  { label: "Serif", value: "serif" },
  { label: "Monospace", value: "monospace" },
  { label: "Arial", value: "Arial" },
  { label: "Helvetica", value: "Helvetica" },
  { label: "Verdana", value: "Verdana" },
  { label: "Tahoma", value: "Tahoma" },
  { label: "Trebuchet MS", value: "Trebuchet MS" },
  { label: "Georgia", value: "Georgia" },
  { label: "Times New Roman", value: "Times New Roman" },
  { label: "Courier New", value: "Courier New" },
];

export function PlayerControls({
  className,
  containerRef,
  visible,
  statsVisible,
  onToggleStats,
}: {
  className?: string;
  /** Kept for API compatibility — no longer used internally. */
  containerRef?: React.RefObject<HTMLElement | null>;
  /**
   * Windowed-overlay visibility, owned by the parent (typically a
   * player container that tracks mouseenter / mouseleave). When this
   * prop is provided AND we're not in fullscreen, the bar's
   * visibility follows this value directly. In fullscreen, this prop
   * is ignored and the JS auto-hide timer takes over.
   */
  visible?: boolean;
  /** "Stats for nerds" overlay visibility — controlled by parent. */
  statsVisible?: boolean;
  /** Callback for the settings-menu "Stats for nerds" toggle. */
  onToggleStats?: () => void;
}) {
  // PlayerControls subscribes ONLY to paused + duration — the two
  // pieces of state that affect the buttons it owns directly. The
  // high-frequency `time_pos` updates (10Hz during playback) are
  // handled by the Scrubber/TimeDisplay sub-components which have
  // their own subscriptions. Same for volume/muted (VolumeSlider).
  //
  // This is the single most impactful perf change in this file: it
  // means a normal playback session triggers ~2-3 PlayerControls
  // re-renders total (one for paused-on-play, one when duration
  // arrives, etc.) instead of 10+ per second.
  const [paused, setPausedFlag] = useState<boolean>(true);
  const [duration, setDuration] = useState<number>(0);
  // EOF: with keep-open=yes mpv parks on the last frame, reporting
  // paused=false but idle. We track it so the play button becomes a
  // "replay" (seek-to-0 + play) instead of a no-op unpause. Changes once
  // per playback end, so the extra re-render is negligible.
  const [eof, setEof] = useState<boolean>(false);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [speed, setSpeed] = useState(1);
  const [openMenu, setOpenMenu] = useState<
    null | "speed" | "audio" | "subs"
  >(null);
  const isFullscreen = useFullscreen();
  // Auto-hide controls in fullscreen, Stremio/YouTube style: visible
  // by default, hide after a few seconds of mouse inactivity, show
  // again on any pointer/keyboard activity. Stays visible while
  // hovering the bar itself or while a menu is open.
  const [controlsVisible, setControlsVisible] = useState(true);
  // Tracks whether the cursor is currently over the controls
  // (top bar or bottom bar). When true, auto-hide pauses.
  const [hoveringControls, setHoveringControls] = useState(false);
  const AUTOHIDE_MS = 3000;

  // Auto-hide controls — fullscreen only. Windowed-overlay
  // visibility comes from the parent via the `visible` prop.
  //
  // Key behavior: hide after AUTOHIDE_MS of NO mouse movement,
  // regardless of where the cursor is — including ON the bar. This
  // matches Stremio / YouTube. Earlier we kept the bar visible while
  // hovering it (`hoveringControls` check) — that meant if the user
  // parked their cursor on the bar, it never hid. Removed.
  //
  // The only thing that suppresses auto-hide is an OPEN menu (so the
  // user can interact with it without it disappearing under them).
  useEffect(() => {
    if (!isFullscreen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setControlsVisible(true);
      return;
    }
    if (openMenu != null) {
      setControlsVisible(true);
      return;
    }

    let timer: ReturnType<typeof setTimeout> | null = null;
    const arm = () => {
      setControlsVisible(true);
      if (timer != null) clearTimeout(timer);
      timer = setTimeout(() => setControlsVisible(false), AUTOHIDE_MS);
    };

    arm();
    window.addEventListener("mousemove", arm, { passive: true });
    window.addEventListener("pointerdown", arm, { passive: true });
    window.addEventListener("keydown", arm);
    return () => {
      if (timer != null) clearTimeout(timer);
      window.removeEventListener("mousemove", arm);
      window.removeEventListener("pointerdown", arm);
      window.removeEventListener("keydown", arm);
    };
  }, [isFullscreen, openMenu]);

  // Cursor hides along with the controls in fullscreen — feels weird
  // to see the arrow hovering over a clean video frame.
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (isFullscreen && !controlsVisible) {
      document.body.style.cursor = "none";
    } else {
      document.body.style.cursor = "";
    }
    return () => {
      document.body.style.cursor = "";
    };
  }, [isFullscreen, controlsVisible]);

  // Add a body-level class while in fullscreen so global CSS can hide
  // chrome that would otherwise overlay the video (sidebar, etc.).
  // mpv NSView paints BELOW the webview now, so any opaque HTML in
  // its rect will cover the video. The class triggers display:none
  // rules in globals.css — see `body.player-fullscreen` selectors.
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (isFullscreen) {
      document.body.classList.add("player-fullscreen");
    } else {
      document.body.classList.remove("player-fullscreen");
    }
    return () => {
      document.body.classList.remove("player-fullscreen");
    };
  }, [isFullscreen]);

  useEffect(() => {
    // Custom equality: only call setState when the fields PlayerControls
    // cares about actually change. mpv emits state at 10Hz, but
    // `paused` and `duration` rarely change — without this guard we'd
    // re-render the whole bar 10x/sec for no visible reason.
    return mpv.onState((s) => {
      if (s.paused != null) {
        setPausedFlag((prev) => (prev === s.paused ? prev : (s.paused as boolean)));
      }
      if (s.duration != null) {
        setDuration((prev) => (prev === s.duration ? prev : (s.duration as number)));
      }
      setEof((prev) => (prev === s.eof ? prev : s.eof));
    });
  }, []);
  useEffect(() => mpv.onTracks((j) => setTracks(parseTracks(j))), []);

  // Re-apply persisted subtitle style once a file is actually loaded.
  // We can't do this at mount: mpv's instance is created lazily on
  // `attach` (set_property errors with "mpv not attached" before that),
  // and the `sub-*` options only become visible while subs render. The
  // first duration>0 state event is a reliable "attached + file demuxed"
  // signal. mpv keeps these options across later loadfile calls, so
  // applying once per mount is enough. Skipped entirely when the saved
  // style is all-defaults (nothing to override).
  useEffect(() => {
    const saved = loadSubStyle();
    if (isDefaultSubStyle(saved)) return;
    let applied = false;
    const off = mpv.onState((s) => {
      if (applied) return;
      if (s.duration != null && s.duration > 0) {
        applied = true;
        applySubStyle(saved);
        off();
      }
    });
    return off;
  }, []);

  // No --player-controls-h reservation needed anymore. With the new
  // architecture (mpv NSView positioned BELOW the WKWebView, body bg
  // transparent), HTML controls overlay video naturally. The mpv view
  // fills the whole viewport in fullscreen; opaque HTML on top hides
  // video in its pixels.

  // Close any open menu on outside click.
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!openMenu) return;
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpenMenu(null);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [openMenu]);

  const ready = duration > 0;

  const audioTracks = useMemo(
    () => tracks.filter((t) => t.type === "audio"),
    [tracks],
  );
  const subTracks = useMemo(
    () => tracks.filter((t) => t.type === "sub"),
    [tracks],
  );
  const activeSub = subTracks.find((t) => t.selected);

  // True when controls should auto-hide over the video region.
  // Inline-fallback mode (no containerRef, not fullscreen) keeps the
  // legacy "always-visible bar inside page flow" rendering.
  const overlayMode = isFullscreen || containerRef != null;

  const bar = (
    <div
      ref={rootRef}
      className={clsx(
        "select-none overflow-visible",
        // Overlay mode: NO bg, NO border, NO shadow on the bar
        // itself — the gradient wrapper above already provides all
        // the visual separation from the video. YouTube/Stremio
        // style. Cleaner, less heavy.
        // Inline-fallback mode: still gets a visible chrome since
        // it's the only thing on screen.
        overlayMode
          ? "rounded-none"
          : clsx(
              "relative rounded-xl border border-white/[0.06] bg-gradient-to-b from-neutral-900/95 to-neutral-950/95 shadow-[0_10px_40px_rgba(0,0,0,0.45)] backdrop-blur-md",
              className,
            ),
      )}
    >
      {/* Row 1: scrubber — owns its own time_pos/duration/scrubbing
          state. PlayerControls doesn't re-render when the scrubber
          ticks. */}
      <Scrubber />

      {/* Row 2: controls — height locked to 56px (44px play button +
          2×6px vertical padding). Other icon buttons are 40px and
          vertically center inside the 56px row. */}
      <div className="flex items-center gap-2 px-4 py-1.5">
        {/* Left cluster */}
        <IconButton
          label="Back 5s"
          onClick={() =>
            act("seek-5", {}, mpv.seek(-5, "relative")).catch(() => {})
          }
          disabled={!ready}
        >
          {/* Circular-arrow + "5" overlay — the modern seek-by-N
              icon (YouTube mobile, most native players). The number
              sits inside the curved arrow at a small font. */}
          <span className="relative grid place-items-center">
            <RotateCcw size={20} />
            <span className="absolute text-[9px] font-semibold tabular-nums leading-none translate-y-[0.5px]">
              5
            </span>
          </span>
        </IconButton>

        <button
          type="button"
          onClick={() => {
            if (eof) {
              // Ended (keep-open parks on the last frame): a plain unpause
              // won't restart because the position is already at the end.
              // Seek to 0, then play.
              act(
                "replay",
                {},
                mpv.seek(0, "absolute").then(() => mpv.setProperty("pause", false)),
              ).catch(() => {});
              return;
            }
            // Direct set rather than `cycle pause` because:
            //   - state.paused is now reliable (libmpv2 bool fix is in)
            //   - at EOF, mpv reports paused=false but is idle; cycle
            //     would flip to true (not what we want) or no-op then
            //     unflip. Direct set always lands on the value the
            //     user clicked for.
            const next = !paused;
            act("set pause", { from: paused, to: next }, mpv.setProperty("pause", next))
              .catch(() => {});
          }}
          disabled={!ready}
          className={clsx(
            // YouTube-style primary action: same dark pill as the
            // surrounding IconButtons, slightly larger to signal
            // primacy. White icon inside. Literal rgba(), no
            // bg-color transition (see IconButton for the rationale).
            "grid place-items-center w-11 h-11 rounded-full shrink-0 mx-0.5",
            "bg-[rgba(0,0,0,0.6)] text-white cursor-pointer",
            "hover:bg-[rgba(0,0,0,0.85)]",
            "disabled:opacity-40 disabled:cursor-not-allowed",
            "outline-none focus:outline-none",
          )}
          aria-label={paused || eof ? "Play" : "Pause"}
        >
          {!ready ? (
            <Loader2 size={20} className="animate-spin" />
          ) : paused || eof ? (
            <Play size={20} className="ml-0.5 fill-current" />
          ) : (
            <Pause size={20} className="fill-current" />
          )}
        </button>

        <IconButton
          label="Forward 5s"
          onClick={() =>
            act("seek+5", {}, mpv.seek(5, "relative")).catch(() => {})
          }
          disabled={!ready}
        >
          <span className="relative grid place-items-center">
            <RotateCw size={20} />
            <span className="absolute text-[9px] font-semibold tabular-nums leading-none translate-y-[0.5px]">
              5
            </span>
          </span>
        </IconButton>

        <TimeDisplay />

        {/* Spacer */}
        <div className="flex-1" />

        {/* Volume — extracted into its own memoized component that
            subscribes to mpv state directly. Keeps high-frequency
            onChange/state events from re-rendering the entire
            PlayerControls (which was dropping ui fps to 4-8 during
            drag). See VolumeSlider for the rAF-coalesced IPC logic. */}
        <VolumeSlider />

        {/* Subtitles — a two-pane panel: a left sidebar switches between
            the Track list and the Style controls, shown in the content
            area on the right. Selecting a track does NOT close the menu,
            so the user can pick a track and then tune its style in one
            trip. `wide` + `flush` because SubtitlesMenu owns its own
            fixed-height sidebar + scrolling content layout. */}
        <MenuButton
          label="Subtitles"
          icon={<Captions size={17} />}
          active={!!activeSub}
          open={openMenu === "subs"}
          openUp={overlayMode}
          wide
          flush
          onToggle={() => setOpenMenu(openMenu === "subs" ? null : "subs")}
        >
          <SubtitlesMenu subTracks={subTracks} activeSub={activeSub} />
        </MenuButton>

        {/* Audio tracks */}
        <MenuButton
          label="Audio"
          icon={<Languages size={17} />}
          open={openMenu === "audio"}
          openUp={overlayMode}
          onToggle={() => setOpenMenu(openMenu === "audio" ? null : "audio")}
        >
          {audioTracks.length === 0 && (
            <div className="px-3 py-1.5 text-[11px] text-neutral-500">
              (no audio tracks)
            </div>
          )}
          {audioTracks.map((t) => (
            <MenuItem
              key={t.id}
              label={trackLabel(t)}
              active={!!t.selected}
              onClick={() => {
                // String, not number — see the `sid` note above.
                act(
                  "set aid",
                  { id: t.id },
                  mpv.setProperty("aid", String(t.id)),
                ).catch(() => {});
                setOpenMenu(null);
              }}
            />
          ))}
        </MenuButton>

        {/* Speed (own bar icon — speedometer/gauge) */}
        <MenuButton
          label={`Playback speed (${speed}×)`}
          icon={<Gauge size={17} />}
          open={openMenu === "speed"}
          openUp={overlayMode}
          active={speed !== 1}
          onToggle={() =>
            setOpenMenu(openMenu === "speed" ? null : "speed")
          }
        >
          <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-neutral-500">
            Playback speed
          </div>
          {SPEEDS.map((s) => (
            <MenuItem
              key={s}
              label={`${s}×`}
              active={s === speed}
              onClick={() => {
                setSpeed(s);
                act("set speed", { s }, mpv.setProperty("speed", s)).catch(
                  () => {},
                );
                setOpenMenu(null);
              }}
            />
          ))}
        </MenuButton>

        {/* Stats for nerds (own bar icon — activity / live data). */}
        {onToggleStats && (
          <IconButton
            label="Stats for nerds"
            onClick={onToggleStats}
            active={!!statsVisible}
          >
            <Activity size={17} />
          </IconButton>
        )}

        {/* Fullscreen — drives the Tauri window, not mpv. With
            vo=libmpv mpv doesn't own a window so its own
            `fullscreen` property is a no-op. Icon swaps based on
            current state for clear affordance. */}
        <IconButton
          label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
          onClick={() =>
            act("toggle fullscreen", {}, mpv.toggleFullscreen()).catch(
              () => {},
            )
          }
        >
          {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </IconButton>
      </div>
    </div>
  );

  // Legacy fallback: no containerRef + not fullscreen → render bar
  // inline (in normal page flow). Used by any consumer that hasn't
  // switched to the overlay model yet.
  if (!overlayMode) {
    return bar;
  }

  // Fullscreen: the bar floats at the bottom of the viewport
  // independently of the page (fixed). Auto-hide on inactivity.
  // Wrapper carries a subtle ~20% dark tint so the icons + scrubber
  // stay legible against bright video frames (sky, snow, etc.) — same
  // accessibility motivation as YouTube's gradient, but flat (no
  // gradient, no backdrop-blur) to avoid the macOS Retina artifacts
  // documented on IconButton.
  if (isFullscreen) {
    return (
      <div
        onMouseEnter={() => setHoveringControls(true)}
        onMouseLeave={() => setHoveringControls(false)}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        className={clsx(
          "fixed bottom-0 inset-x-0 z-[10000]",
          // Literal rgba() — same reasoning as IconButton (Tailwind's
          // bg-black/N opacity modifier compiles to color-mix(), which
          // WebKit doesn't interpolate cleanly).
          "bg-[rgba(0,0,0,0.2)]",
          // `visibility` toggles with `opacity` to avoid ghost pixels over
          // the native mpv layer — see the windowed-overlay branch below.
          "transition-[opacity,visibility] duration-300 ease-out",
          !controlsVisible && "opacity-0 invisible pointer-events-none",
        )}
      >
        {bar}
      </div>
    );
  }

  // Windowed overlay: parent (the player container) owns the hover
  // state and passes it via the `visible` prop. Wrapper carries the
  // same subtle ~20% dark tint as the fullscreen branch (see comment
  // above). `stopPropagation` on click / dblclick so bar interactions
  // don't bubble to the player container's play/pause / fullscreen
  // toggles. Mousemove / enter / leave INTENTIONALLY bubble — they
  // keep the parent's auto-hide timer alive while the user interacts
  // with the bar.
  const overlayVisible = visible ?? true;
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      className={clsx(
        // Literal rgba() — see fullscreen branch above.
        // We toggle `visibility` alongside `opacity` (not opacity alone)
        // to fix ghost pixels: mpv paints into a native layer BELOW this
        // transparent webview, and WebKit doesn't reliably re-clear the
        // controls' region to transparent when only `opacity` goes to 0 —
        // especially while paused, when no new video frame forces a
        // recomposite, so faint scrubber/bar pixels linger. `invisible`
        // (visibility:hidden) drops the bar from painting entirely, which
        // marks the region dirty and repaints it transparent. Visibility
        // transitions stepwise, so it flips only at the end of the fade
        // and the smooth fade-out is preserved.
        "w-full bg-[rgba(0,0,0,0.2)] transition-[opacity,visibility] duration-300 ease-out",
        overlayVisible
          ? "opacity-100 visible"
          : "opacity-0 invisible pointer-events-none",
      )}
    >
      {bar}
    </div>
  );
}

// --- volume slider --------------------------------------------------
//
// Lives in its own memoized component so high-frequency volume events
// don't bubble up and force PlayerControls to re-render. Earlier the
// drag fps was tanking to 4-8fps: every onChange fired setState on
// PlayerControls (huge tree), and every IPC echo from mpv fired
// another setState. Now:
//   - Volume + muted subscribe directly to mpv.onState here, so the
//     parent's render is unaffected by volume changes.
//   - The slider re-renders ~60Hz during drag (small, cheap subtree),
//     not the whole controls bar.
//   - rAF coalesces both the React setState AND the mpv IPC into one
//     update per animation frame — caps work at the screen refresh
//     rate regardless of how fast the input fires.
//   - During drag we ignore mpv's authoritative state events (state
//     echoes lag behind the latest user value and would cause jitter
//     /snap-back). Released → mpv state takes over again.

// Pointer-event-driven track. Returns the value (0-100) from a
// clientX position via direct linear mapping — no native input dead
// zones to fight. Uses `setPointerCapture` so drag continues even
// when the cursor leaves the element.
function VolumeTrack({
  volPct,
  onPointerDownVal,
  onPointerMoveVal,
  onPointerUpVal,
}: {
  volPct: number;
  onPointerDownVal: (v: number) => void;
  onPointerMoveVal: (v: number) => void;
  onPointerUpVal: (v: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  // Pointer capture id — non-null while a drag is active. We capture
  // on the track div itself so we keep receiving move/up even if the
  // cursor moves outside the element bounds.
  const captureRef = useRef<{ id: number; el: Element } | null>(null);

  const valueAt = (clientX: number): number => {
    const r = trackRef.current?.getBoundingClientRect();
    if (!r || r.width <= 0) return 0;
    const pct = ((clientX - r.left) / r.width) * 100;
    return Math.max(0, Math.min(100, pct));
  };

  return (
    <div
      ref={trackRef}
      role="slider"
      aria-label="Volume"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(volPct)}
      tabIndex={0}
      className="relative w-20 h-6 flex items-center group cursor-pointer touch-none"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        const el = e.currentTarget;
        try {
          el.setPointerCapture(e.pointerId);
          captureRef.current = { id: e.pointerId, el };
        } catch {
          /* setPointerCapture can fail in tests/iframes */
        }
        onPointerDownVal(valueAt(e.clientX));
      }}
      onPointerMove={(e) => {
        if (captureRef.current == null) return;
        onPointerMoveVal(valueAt(e.clientX));
      }}
      onPointerUp={(e) => {
        if (captureRef.current == null) return;
        try {
          captureRef.current.el.releasePointerCapture(captureRef.current.id);
        } catch {
          /* released already */
        }
        captureRef.current = null;
        onPointerUpVal(valueAt(e.clientX));
      }}
      onPointerCancel={(e) => {
        if (captureRef.current == null) return;
        captureRef.current = null;
        onPointerUpVal(valueAt(e.clientX));
      }}
    >
      <div className="absolute inset-x-0 h-[3px] rounded-full bg-white/15 pointer-events-none" />
      <div
        className="absolute h-[3px] rounded-full bg-white pointer-events-none"
        style={{ width: `${volPct}%` }}
      >
        <div
          className="absolute right-0 top-1/2 w-2.5 h-2.5 rounded-full bg-white pointer-events-none transition-opacity opacity-0 group-hover:opacity-100"
          style={{ transform: "translate(50%, -50%)" }}
        />
      </div>
    </div>
  );
}

const VolumeSlider = memo(function VolumeSlider() {
  const [volume, setVolume] = useState(100);
  const [muted, setMuted] = useState(false);
  const [localVol, setLocalVol] = useState<number | null>(null);
  // Ignore-mpv-state-while-dragging flag. Set to true on pointerdown,
  // cleared on pointerup. Without it, an in-flight mpv state event
  // (with a slightly stale volume) could overwrite the user's just-
  // dragged value in mid-drag.
  const draggingRef = useRef(false);
  // Authoritative target for mute. React state lags ~100-300ms behind
  // mpv echoes, so rapid double-click reads stale `muted` twice and
  // both clicks dispatch the SAME target — mute ends up where the
  // first click put it. The ref always holds the latest desired
  // value, updated synchronously on every click. Initialised from
  // mpv state echoes too so it stays consistent if mute changes from
  // outside (keyboard shortcut, etc).
  const targetMutedRef = useRef(false);

  // Echo suppression: after pointerUp commits a new value to mpv, the
  // *next* state echo (~100-300ms later in our dumps) is the one
  // confirming our write. But any echoes already in flight from BEFORE
  // the commit are stale and would snap the slider back to the
  // previous value briefly before the confirming echo arrives. We
  // optimistically setVolume(committedValue) at commit time and then
  // reject any echo whose value differs from `expectedVol` until
  // either the confirming echo matches (clear suppression) or the
  // window expires (give up; trust mpv as ground truth).
  const expectedVolRef = useRef<number | null>(null);
  const expectedExpiresRef = useRef(0);

  useEffect(() => {
    return mpv.onState((s) => {
      if (s.volume != null) {
        if (draggingRef.current) {
          // Mid-drag: ignore state echoes entirely. The slider is
          // user-driven until pointerUp.
        } else if (expectedVolRef.current != null) {
          if (performance.now() < expectedExpiresRef.current) {
            // We're still waiting for the confirming echo.
            if (Math.abs(s.volume - expectedVolRef.current) <= 0.5) {
              // Echo matches our committed value — confirmation
              // arrived. Clear suppression and accept.
              expectedVolRef.current = null;
              setVolume(s.volume);
            }
            // else: stale in-flight echo, drop it.
          } else {
            // Suppression window expired. Trust whatever mpv reports.
            expectedVolRef.current = null;
            setVolume(s.volume);
          }
        } else {
          setVolume(s.volume);
        }
      }
      if (s.muted != null) {
        setMuted(s.muted);
        targetMutedRef.current = s.muted;
      }
    });
  }, []);

  // rAF coalescer for visual + throttled IPC.
  //
  // Visual: every rAF (~60Hz) → setLocalVol so the slider tracks the
  //   cursor pixel-for-pixel with no perceivable lag.
  // IPC:   throttled to ~10Hz (one setProperty every 100ms during the
  //   drag) so the user HEARS the volume change in real time, which
  //   is what most users expect from a volume slider. We tried 60Hz
  //   IPC originally and it dropped ui fps to 4-8 because each
  //   round-trip stalls the WKWebView compositor; 10Hz is the sweet
  //   spot — perceptually-smooth audio updates with no measurable fps
  //   impact in our dumps. Final exact value commits on pointer-up.
  const pendingRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastIpcRef = useRef(0);
  const IPC_INTERVAL_MS = 100;
  const flush = () => {
    rafRef.current = null;
    const v = pendingRef.current;
    pendingRef.current = null;
    if (v != null) {
      setLocalVol(v);
      const now = performance.now();
      if (now - lastIpcRef.current >= IPC_INTERVAL_MS) {
        lastIpcRef.current = now;
        // No logging on the throttled tick — we already log
        // drag-start / drag-end at the interaction boundaries, and
        // logging every 100ms tick would flood the dump.
        mpv.setProperty("volume", v).catch(() => {});
      }
    }
  };
  const schedule = (v: number) => {
    pendingRef.current = v;
    if (rafRef.current == null) {
      rafRef.current = requestAnimationFrame(flush);
    }
  };
  useEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const displayVol = localVol ?? volume;
  const volPct = Math.max(0, Math.min(100, displayVol));

  return (
    <div className="flex items-center gap-1.5">
      <IconButton
        label={muted ? "Unmute" : "Mute"}
        onClick={() => {
          // Read the target from the ref, not React state, so rapid
          // double-clicks (faster than mpv's echo round-trip) each
          // produce a distinct toggle instead of two clicks landing
          // on the same stale value. Update the ref synchronously
          // before dispatch so the NEXT click sees the new target.
          const next = !targetMutedRef.current;
          targetMutedRef.current = next;
          // Optimistic UI: flip the icon immediately. mpv echo (~100ms
          // later) will confirm and is a no-op for state.
          setMuted(next);
          trackAction(
            "toggle mute",
            { to: next },
            mpv.setProperty("mute", next),
          ).catch(() => {});
        }}
      >
        {muted || volume === 0 ? <VolumeX size={17} /> : <Volume2 size={17} />}
      </IconButton>
      {/* Track + pointer events. We replaced the native <input
          type="range"> because WebKit's invisible thumb has finite
          width (~16px on macOS), and the input maps clicks to value
          using a non-linear formula that accounts for thumb-width
          dead zones — value 0% lands the native thumb's CENTER at
          `thumbWidth/2` from the left, but our visual fill draws to
          0px. That mismatch produced the offset between the cursor
          and the visual thumb during drag. Using pointer events on
          the track div and computing value from clientX directly
          gives a perfectly linear 0 → 100 across the full width. */}
      <VolumeTrack
        volPct={volPct}
        onPointerDownVal={(v) => {
          draggingRef.current = true;
          setLocalVol(v);
          // Fire one IPC immediately so a single click on the track
          // (no drag) still updates volume audibly. Subsequent
          // pointerMoves go through the rAF + IPC throttle.
          lastIpcRef.current = performance.now();
          mpv.setProperty("volume", v).catch(() => {});
          trackAction(
            "volume drag-start",
            { from: v },
            Promise.resolve(),
          ).catch(() => {});
        }}
        onPointerMoveVal={(v) => {
          if (!draggingRef.current) return;
          schedule(v);
        }}
        onPointerUpVal={(v) => {
          if (!draggingRef.current) return;
          if (rafRef.current != null) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
          }
          // Optimistic update + echo suppression so clearing
          // `localVol` doesn't snap back to the pre-drag value while
          // we wait for the confirming echo from mpv.
          setVolume(v);
          expectedVolRef.current = v;
          expectedExpiresRef.current = performance.now() + 500;
          draggingRef.current = false;
          setLocalVol(null);
          trackAction(
            "volume drag-end",
            { to: v },
            mpv.setProperty("volume", v),
          ).catch(() => {});
        }}
      />
    </div>
  );
});

// --- helpers --------------------------------------------------------

function IconButton({
  children,
  label,
  onClick,
  disabled,
  active,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={clsx(
        "grid place-items-center w-10 h-10 shrink-0 rounded-full cursor-pointer",
        // Bg as a literal rgba() value, NOT Tailwind's `bg-black/N`
        // opacity-modifier shorthand. Reason: Tailwind 4 compiles
        // `bg-black/60` to `color-mix(in oklab, var(--color-black) 60%,
        // transparent)`, and WebKit does NOT smoothly interpolate
        // between two color-mix() outputs — mid-transition it falls
        // through to the parent's inherited bg (which is transparent
        // here), produces a visible "spike then fade to 0%" glitch on
        // hover-off, then snaps back to the destination. Plain rgba()
        // animates as a single color value with no indirection. We
        // also drop the bg-color transition entirely: snap-in /
        // snap-out is glitch-free by construction. Hover affordance is
        // still instant.
        //
        // Active state (e.g. Stats-for-nerds toggled on, subtitles on,
        // non-1× speed) swaps the pill to a violet tint so the user
        // can see at a glance which toggles are live. Same flat-pill
        // shape, just a colored fill — no glow, no ring, no shadow.
        active
          ? "bg-[rgba(139,92,246,0.4)] hover:bg-[rgba(139,92,246,0.6)] text-violet-100"
          : "bg-[rgba(0,0,0,0.6)] hover:bg-[rgba(0,0,0,0.85)] text-white",
        "disabled:opacity-40 disabled:cursor-not-allowed",
        "outline-none focus:outline-none",
      )}
    >
      {children}
    </button>
  );
}

function MenuButton({
  children,
  label,
  icon,
  open,
  onToggle,
  openUp,
  active,
  wide,
  flush,
}: {
  children: React.ReactNode;
  label: string;
  icon: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  /** When true, open the dropdown ABOVE the trigger instead of below.
   *  PlayerControls passes `isFullscreen` because in fullscreen the
   *  bar is glued to the viewport bottom and a downward menu would
   *  fall off-screen. PlayerControls also expands the reserved
   *  bottom strip when a menu is open, so the upward menu has room
   *  above the bar before the mpv NSView paints over it. */
  openUp?: boolean;
  active?: boolean;
  /** Wider/taller panel for content richer than a track list — the
   *  subtitles panel's sidebar + sliders/pickers. Default panels are
   *  sized for short label lists. */
  wide?: boolean;
  /** Let the child own all padding + scrolling (the panel drops its
   *  default `py-1` + `overflow-auto`). Used by the subtitles panel,
   *  which lays out a fixed-height sidebar beside a scrolling content
   *  pane and must clip at the rounded corners. */
  flush?: boolean;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        aria-label={label}
        title={label}
        className={clsx(
          "grid place-items-center w-10 h-10 shrink-0 rounded-full cursor-pointer",
          // Same active/inactive treatment as IconButton — violet pill
          // when a non-default selection is live (or the dropdown is
          // open). See IconButton for the rgba()/color-mix() rationale.
          open || active
            ? "bg-[rgba(139,92,246,0.4)] hover:bg-[rgba(139,92,246,0.6)] text-violet-100"
            : "bg-[rgba(0,0,0,0.6)] hover:bg-[rgba(0,0,0,0.85)] text-white",
          "outline-none focus:outline-none",
        )}
      >
        {icon}
      </button>
      {open && (
        <div
          className={clsx(
            "absolute right-0 rounded-lg bg-neutral-900/98 border border-white/10 shadow-2xl z-50",
            flush ? "overflow-hidden" : "overflow-auto py-1",
            wide
              ? "w-[380px] max-h-[360px]"
              : "min-w-[180px] max-w-[280px] max-h-[200px]",
            // Fade + slide-in entrance — soft "drawer appearing"
            // animation so the menu doesn't pop into existence
            // (matches the smooth height transition on the container).
            openUp
              ? "bottom-full mb-2 animate-[menu-up_150ms_ease-out]"
              : "top-full mt-2 animate-[menu-down_150ms_ease-out]",
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}

function MenuItem({
  label,
  active,
  onClick,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-left transition-colors cursor-pointer",
        // Literal rgba() — NOT Tailwind's `bg-white/N` shorthand, which
        // compiles to color-mix() and glitches ("spike then fade") on
        // hover-off under `transition-colors` in WebKit. Same fix as
        // IconButton; rgba interpolates as a clean alpha fade. The
        // transparent base makes the unhover a pure alpha animation.
        active
          ? "text-violet-300 bg-[rgba(139,92,246,0.1)]"
          : "text-neutral-200 bg-[rgba(255,255,255,0)] hover:bg-[rgba(255,255,255,0.06)]",
      )}
    >
      <Check
        size={12}
        className={clsx("shrink-0", !active && "invisible")}
      />
      <span className="truncate">{label}</span>
    </button>
  );
}

// --- subtitles menu -------------------------------------------------
//
// Two-pane subtitle panel: a left sidebar switches between the Track
// list (selection) and the Style controls; the chosen pane renders in
// the content area on the right. The active-pane state lives here so
// switching tabs doesn't re-render the whole controls bar.

function SubtitlesMenu({
  subTracks,
  activeSub,
}: {
  subTracks: Track[];
  activeSub?: Track;
}) {
  const [pane, setPane] = useState<"track" | "style">("track");
  return (
    <div className="flex h-[320px]">
      {/* Sidebar — the two menus */}
      <div className="w-[104px] shrink-0 border-r border-white/10 py-1 flex flex-col gap-0.5">
        <SubtitlesTab
          label="Track"
          active={pane === "track"}
          onClick={() => setPane("track")}
        />
        <SubtitlesTab
          label="Style"
          active={pane === "style"}
          onClick={() => setPane("style")}
        />
      </div>
      {/* Content pane for the selected menu */}
      <div className="flex-1 overflow-auto py-1">
        {pane === "track" ? (
          <>
            <MenuItem
              label="Off"
              active={!activeSub}
              onClick={() => {
                act("sid off", {}, mpv.setProperty("sid", "no")).catch(
                  () => {},
                );
              }}
            />
            {subTracks.length === 0 && (
              <div className="px-3 py-1.5 text-[11px] text-neutral-500">
                (no subtitle tracks)
              </div>
            )}
            {subTracks.map((t) => (
              <MenuItem
                key={t.id}
                label={trackLabel(t)}
                active={!!t.selected}
                onClick={() => {
                  // Track IDs MUST go through set_property_str: `sid`/`aid`
                  // are choice/track-selection properties and mpv rejects
                  // setting them via MPV_FORMAT_DOUBLE (the route a numeric
                  // value would take), so a number silently no-ops and the
                  // selection stays on the default track.
                  act(
                    "set sid",
                    { id: t.id },
                    mpv.setProperty("sid", String(t.id)),
                  ).catch(() => {});
                }}
              />
            ))}
          </>
        ) : (
          <SubtitleStyleMenu />
        )}
      </div>
    </div>
  );
}

function SubtitlesTab({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "mx-1 px-2.5 py-1.5 rounded text-[12px] text-left transition-colors cursor-pointer",
        // Literal rgba() — see MenuItem/IconButton for the color-mix() glitch.
        active
          ? "text-violet-200 bg-[rgba(139,92,246,0.18)]"
          : "text-neutral-300 bg-[rgba(255,255,255,0)] hover:bg-[rgba(255,255,255,0.06)]",
      )}
    >
      {label}
    </button>
  );
}

// --- subtitle style menu --------------------------------------------
//
// Memoized so dragging a slider re-renders only this subtree, not the
// whole controls bar (same motivation as VolumeSlider). Initializes
// from the persisted style each time it opens; every change writes
// through to localStorage AND mpv so the effect is live + remembered.

const SubtitleStyleMenu = memo(function SubtitleStyleMenu() {
  const [style, setStyle] = useState<SubStyle>(() => loadSubStyle());

  const commit = (next: SubStyle) => {
    setStyle(next);
    saveSubStyle(next);
    applySubStyle(next);
  };
  const update = (partial: Partial<SubStyle>) =>
    commit({ ...style, ...partial });

  return (
    <div className="px-3 py-2 space-y-3">
      <StyleSlider
        label="Size"
        min={20}
        max={100}
        step={1}
        value={style.size}
        property="sub-font-size"
        format={(v) => `${Math.round(v)}`}
        onCommit={(v) => update({ size: v })}
      />
      <StyleSlider
        label="Position"
        min={0}
        max={150}
        step={1}
        value={style.pos}
        property="sub-pos"
        format={(v) => `${Math.round(v)}`}
        onCommit={(v) => update({ pos: v })}
      />
      <StyleSlider
        label="Delay"
        min={-10}
        max={10}
        step={0.1}
        value={style.delay}
        property="sub-delay"
        format={(v) => `${v > 0 ? "+" : ""}${v.toFixed(1)}s`}
        onCommit={(v) => update({ delay: Math.round(v * 10) / 10 })}
      />

      <div className="flex items-center gap-5">
        <StyleColor
          label="Text"
          value={style.color}
          onChange={(v) => update({ color: v })}
        />
        <StyleColor
          label="Outline"
          value={style.outline}
          onChange={(v) => update({ outline: v })}
        />
      </div>

      <label className="flex items-center justify-between gap-2">
        <span className="text-[12px] text-neutral-300">Font</span>
        <select
          value={style.font}
          onChange={(e) => update({ font: e.target.value })}
          className="flex-1 max-w-[160px] px-1.5 py-1 rounded bg-neutral-800 border border-white/10 text-[12px] text-neutral-200 focus:outline-none focus:border-violet-500/50 cursor-pointer"
        >
          {SUB_FONT_OPTIONS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </label>

      <button
        type="button"
        onClick={() => commit({ ...SUB_STYLE_DEFAULTS })}
        // Literal rgba() instead of Tailwind's color-mix() shorthand so the
        // transition-colors hover fade doesn't glitch on hover-off (see
        // MenuItem / IconButton rationale).
        className="w-full mt-1 px-2 py-1.5 rounded bg-[rgba(255,255,255,0.06)] hover:bg-[rgba(255,255,255,0.1)] text-[12px] text-neutral-200 transition-colors cursor-pointer"
      >
        Reset to defaults
      </button>
    </div>
  );
});

// Same lag fix as VolumeSlider: a naive onChange that re-applied the
// whole style every tick fired 7 setProperty IPC calls per drag step,
// which stalled the WKWebView compositor and dropped ui fps to single
// digits. Here we (a) track the cursor visually every rAF via local
// state, (b) push ONLY this slider's property to mpv, throttled to
// ~10Hz, during the drag, and (c) commit the full style (persistence +
// sub-ass-override mode) once on drag-end via onCommit.
//
// Why a NATIVE <input type=range> here, while Volume/Scrubber use custom
// pointer tracks: those two need pixel-exact cursor↔thumb tracking (the
// native thumb's dead-zone caused a visible offset during a precise
// seek/volume drag). Sub-style size/position/delay don't need that
// precision, and the native range brings built-in keyboard accessibility
// (arrow keys, Home/End) for free — which the custom tracks lack. The
// inconsistency is deliberate: precision where it matters, accessibility
// where it's cheap.
function StyleSlider({
  label,
  min,
  max,
  step,
  value,
  property,
  format,
  onCommit,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  property: string;
  format: (v: number) => string;
  onCommit: (v: number) => void;
}) {
  const [local, setLocal] = useState<number | null>(null);
  const display = local ?? value;

  const pendingRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastIpcRef = useRef(0);
  const IPC_INTERVAL_MS = 100;

  const flush = () => {
    rafRef.current = null;
    const v = pendingRef.current;
    pendingRef.current = null;
    if (v == null) return;
    setLocal(v);
    const now = performance.now();
    if (now - lastIpcRef.current >= IPC_INTERVAL_MS) {
      lastIpcRef.current = now;
      mpv.setProperty(property, v).catch(() => {});
    }
  };
  const schedule = (v: number) => {
    pendingRef.current = v;
    if (rafRef.current == null) {
      rafRef.current = requestAnimationFrame(flush);
    }
  };
  const commit = (v: number) => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    pendingRef.current = null;
    setLocal(null);
    // Marker only (no extra IPC) so the debug dump can correlate a
    // subtitle-style drag with any fps hitch; onCommit does the writes.
    act(`sub ${property} drag-end`, { to: v }, Promise.resolve()).catch(
      () => {},
    );
    onCommit(v);
  };
  useEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[12px] text-neutral-300">{label}</span>
        <span className="text-[11px] tabular-nums text-neutral-400">
          {format(display)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={display}
        // Editing implies a non-default value, so force our options to
        // win over embedded ASS styling for the live preview; onCommit's
        // applySubStyle restores the correct scale/force mode.
        onPointerDown={() => {
          mpv.setProperty("sub-ass-override", "force").catch(() => {});
          act(`sub ${property} drag-start`, { from: value }, Promise.resolve()).catch(
            () => {},
          );
        }}
        onChange={(e) => schedule(parseFloat(e.target.value))}
        onPointerUp={(e) =>
          commit(parseFloat((e.target as HTMLInputElement).value))
        }
        onKeyUp={(e) =>
          commit(parseFloat((e.target as HTMLInputElement).value))
        }
        className="w-full accent-violet-500 cursor-pointer"
      />
    </div>
  );
}

function StyleColor({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <span className="text-[12px] text-neutral-300">{label}</span>
      {/* The native <input type=color> swatch renders empty under the
          host app's CSS reset, so the active color was invisible. Show
          the color on a span we fully control and overlay a transparent
          native input on top to keep the OS color picker. */}
      <span
        className="relative w-7 h-6 rounded border border-white/10 overflow-hidden"
        style={{ backgroundColor: value }}
      >
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        />
      </span>
    </label>
  );
}

// --- scrubber -------------------------------------------------------
//
// Owns its own time_pos/duration subscription. Re-renders ~10x/sec
// during playback (mpv's native state-event rate), but the WHOLE
// PlayerControls bar stays stable around it.

const Scrubber = memo(function Scrubber() {
  const [timePos, setTimePos] = useState(0);
  const [duration, setDuration] = useState(0);
  const [scrubbing, setScrubbing] = useState<number | null>(null);
  const [hoverPct, setHoverPct] = useState<number | null>(null);

  // Echo suppression: after a seek commit, `setScrubbing(null)` flips
  // displayTime back to the React `timePos` state — which still has
  // the OLD time until mpv echoes the new position (~50-200ms later).
  // Visible result: thumb snaps to old time then back. We suppress
  // stale echoes for a short window after commit, same pattern as
  // VolumeSlider's expectedVol suppression.
  const expectedTimeRef = useRef<number | null>(null);
  const expectedExpiresRef = useRef(0);

  useEffect(() => {
    return mpv.onState((s) => {
      if (s.time_pos != null) {
        // If we're expecting a confirming echo after a seek, drop any
        // stale time_pos events that aren't close to the target. mpv
        // continues to emit time_pos for the OLD position briefly
        // until the seek lands — those are the snap-back culprits.
        if (expectedTimeRef.current != null) {
          const now = performance.now();
          if (now < expectedExpiresRef.current) {
            // Accept only if close to our committed target.
            if (Math.abs(s.time_pos - expectedTimeRef.current) <= 0.5) {
              expectedTimeRef.current = null;
              setTimePos((prev) => (prev === s.time_pos ? prev : (s.time_pos as number)));
            }
            // else: stale pre-seek echo, ignore.
          } else {
            // Window expired — trust mpv.
            expectedTimeRef.current = null;
            setTimePos((prev) => (prev === s.time_pos ? prev : (s.time_pos as number)));
          }
        } else {
          // Only call setState when the value actually changed —
          // React's bail-out keeps from re-rendering on every echo
          // when nothing moved (e.g., during pause).
          setTimePos((prev) => (prev === s.time_pos ? prev : (s.time_pos as number)));
        }
      }
      if (s.duration != null) {
        setDuration((prev) => (prev === s.duration ? prev : (s.duration as number)));
      }
    });
  }, []);

  const ready = duration > 0;
  const rawTime = scrubbing ?? timePos;
  const effectiveTime = Math.max(0, Math.min(rawTime, duration || rawTime));
  const progressPct = ready ? (effectiveTime / duration) * 100 : 0;
  const hoverTime =
    hoverPct != null && duration > 0 ? (duration * hoverPct) / 100 : null;

  const trackRef = useRef<HTMLDivElement | null>(null);
  // Pointer capture for drag — same pattern as VolumeTrack. Lets us
  // bypass the native <input type="range"> which adds thumb-width dead
  // zones to its value mapping (caused visible offset between cursor
  // and thumb during drag).
  const captureRef = useRef<{ id: number; el: Element } | null>(null);

  // Compute the seek time from a clientX. Linear: 0% of track width
  // → t=0, 100% → t=duration. Returns null when not ready (no duration).
  const timeAt = (clientX: number): number | null => {
    if (!ready) return null;
    const r = trackRef.current?.getBoundingClientRect();
    if (!r || r.width <= 0) return null;
    const pct = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    return pct * duration;
  };

  const commit = (v: number) => {
    setTimePos(v);
    expectedTimeRef.current = v;
    expectedExpiresRef.current = performance.now() + 500;
    trackAction("seek", { to: v }, mpv.seek(v))
      .catch(() => {})
      .finally(() => setScrubbing(null));
  };

  return (
    <div className="px-4 pt-3 pb-1">
      <div
        ref={trackRef}
        role="slider"
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={duration || 0}
        aria-valuenow={effectiveTime}
        aria-disabled={!ready}
        tabIndex={ready ? 0 : -1}
        className={clsx(
          "relative h-5 flex items-center group touch-none",
          ready ? "cursor-pointer" : "cursor-default",
        )}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const pct = Math.max(
            0,
            Math.min(100, ((e.clientX - r.left) / r.width) * 100),
          );
          setHoverPct(pct);
        }}
        onMouseLeave={() => setHoverPct(null)}
        onPointerDown={(e) => {
          if (e.button !== 0 || !ready) return;
          const v = timeAt(e.clientX);
          if (v == null) return;
          const el = e.currentTarget;
          try {
            el.setPointerCapture(e.pointerId);
            captureRef.current = { id: e.pointerId, el };
          } catch {
            /* ignore */
          }
          setScrubbing(v);
        }}
        onPointerMove={(e) => {
          if (captureRef.current == null) return;
          const v = timeAt(e.clientX);
          if (v != null) setScrubbing(v);
        }}
        onPointerUp={(e) => {
          if (captureRef.current == null) return;
          try {
            captureRef.current.el.releasePointerCapture(captureRef.current.id);
          } catch {
            /* ignore */
          }
          captureRef.current = null;
          const v = timeAt(e.clientX);
          if (v != null) commit(v);
          else setScrubbing(null);
        }}
        onPointerCancel={(e) => {
          if (captureRef.current == null) return;
          captureRef.current = null;
          const v = timeAt(e.clientX);
          if (v != null) commit(v);
          else setScrubbing(null);
        }}
      >
        {/* Background track — only height animates, not width. */}
        <div className="absolute inset-x-0 h-1 rounded-full bg-white/15 pointer-events-none group-hover:h-1.5 transition-[height] duration-150" />
        {/* Filled portion — NO width transition. mpv pushes time_pos
            at ~10Hz; a 150ms width animation would make the fill
            chronically lag the real position, and the thumb (which
            sits at the right edge below) would visually disconnect
            from it. Only animate the height for the hover-expand. */}
        <div
          className="absolute h-1 rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 pointer-events-none group-hover:h-1.5 transition-[height] duration-150"
          style={{ width: `${progressPct}%` }}
        >
          {/* Thumb nested INSIDE the fill so it physically can't diverge
              from the right edge. `right-0 + translate-x-1/2` anchors
              its center exactly on the fill's right boundary. */}
          <div
            className={clsx(
              "absolute right-0 top-1/2 w-3 h-3 rounded-full bg-white ring-2 ring-violet-500/30 pointer-events-none transition-opacity",
              !ready && "opacity-0",
            )}
            style={{ transform: "translate(50%, -50%)" }}
          />
        </div>
        {/* Hover preview indicator */}
        {hoverPct != null && (
          <div
            className="absolute h-1 rounded-full bg-white/25 pointer-events-none group-hover:h-1.5 transition-[height] duration-150"
            style={{ width: `${hoverPct}%` }}
          />
        )}
        {/* Hover time tooltip */}
        {hoverTime != null && (
          <div
            className="absolute -top-7 px-1.5 py-0.5 rounded text-[10px] font-mono bg-black/90 text-white shadow pointer-events-none -translate-x-1/2 tabular-nums"
            style={{ left: `${hoverPct}%` }}
          >
            {formatTime(hoverTime)}
          </div>
        )}
      </div>
    </div>
  );
});

// --- time display ---------------------------------------------------
//
// Subscribes to time_pos/duration directly. Re-renders ~10x/sec
// during playback (driven by mpv's state events), but isolated so
// PlayerControls doesn't.

const TimeDisplay = memo(function TimeDisplay() {
  const [timePos, setTimePos] = useState(0);
  const [duration, setDuration] = useState(0);
  useEffect(() => {
    return mpv.onState((s) => {
      if (s.time_pos != null) {
        setTimePos((prev) => (prev === s.time_pos ? prev : (s.time_pos as number)));
      }
      if (s.duration != null) {
        setDuration((prev) => (prev === s.duration ? prev : (s.duration as number)));
      }
    });
  }, []);
  return (
    <div className="text-[12px] font-mono tabular-nums shrink-0 ml-3 select-text bg-[rgba(0,0,0,0.6)] rounded-full px-3 py-1.5">
      <span className="text-white font-semibold">{formatTime(timePos)}</span>
      <span className="text-neutral-400"> / {formatTime(duration)}</span>
    </div>
  );
});
