"use client";
// Shared video surface for Movies + TV.
//
// On macOS-in-Tauri it renders the libmpv player (tauri-plugin-mpv-player):
// an NSView painted below the transparent webview, with the package's
// Stremio-style overlay controls. Everywhere else (Windows/Linux, plain
// browser) it falls back to the native <video> element so playback keeps
// working until the plugin gains those platforms.
//
// The component owns ONLY the video surface + its transport controls. Parents
// keep their own chrome (title bar, footer, loading/stats/error overlays) and
// drive this via a small uniform prop surface: a single `src`, an optional
// subtitle list + active id, resume position, and lifecycle callbacks
// (ready/waiting/playing/error/progress). Use `useMpvSupported()` in the
// parent to branch any platform-specific chrome (PiP, which src to pass).

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import clsx from "clsx";
import {
  MpvPlayer,
  type MpvPlayerRef,
  PlayerControls,
  PlayerActionFeedback,
} from "@artpumpkin/mpv-player/react";
import { mpv, setLogger, type MpvState } from "@artpumpkin/mpv-player";
import "@artpumpkin/mpv-player/styles.css";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useMpvSupported } from "@/lib/player/platform";
import { logger } from "@/lib/logger";

// Route the mpv plugin's internal logs (attach / load / state / buffer) into
// Mosaic's logger so they surface in the in-app debug panel (Bug icon).
setLogger(logger);

export type VideoStageSubtitle = {
  id: string;
  url: string; // http(s) URL or local file path mpv can read (NOT blob:)
  lang: string;
  label?: string;
};

export type VideoStageHandle = {
  /** Native <video> element when on the native path, else null (mpv path). */
  getVideoEl: () => HTMLVideoElement | null;
  /** True when the mpv surface is active (no native <video>, no browser PiP). */
  isMpv: boolean;
};

type Props = {
  /** URL to play. For mpv this must be something libmpv can fetch (http/file);
   *  parents resolve torrents to the local HTTP bridge on the mpv path. */
  src: string | null;
  autoplay?: boolean;
  /** Seek here once the media reports a duration (resume). */
  resumePosition?: number;
  /** Native fallback only: route through hls.js when the source is HLS and the
   *  browser can't play it natively. mpv handles HLS itself. */
  hls?: boolean;
  crossOrigin?: string;
  /** Subtitles to expose on the mpv path (sub-add). Ignored on native — pass
   *  <track> elements as children there instead. */
  subtitles?: VideoStageSubtitle[];
  activeSubId?: string | null;
  onReady?: () => void;
  onWaiting?: () => void;
  onPlaying?: () => void;
  onError?: (info: { code?: number; message?: string }) => void;
  onProgress?: (positionSec: number, durationSec: number) => void;
  className?: string;
  /** Native-path-only extra DOM rendered inside <video> (e.g. <track>). */
  children?: React.ReactNode;
};

const AUTOHIDE_MS = 3000;

export const VideoStage = forwardRef<VideoStageHandle, Props>(function VideoStage(
  {
    src,
    autoplay = true,
    resumePosition,
    hls = false,
    crossOrigin,
    subtitles,
    activeSubId,
    onReady,
    onWaiting,
    onPlaying,
    onError,
    onProgress,
    className,
    children,
  },
  ref,
) {
  const mpvSupported = useMpvSupported();
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      getVideoEl: () => videoRef.current,
      isMpv: mpvSupported === true,
    }),
    [mpvSupported],
  );

  // Pending until platform is resolved, so we never mount MpvPlayer (which
  // eagerly attaches) on the wrong platform.
  if (mpvSupported === null) {
    return <div className={clsx("bg-black", className)} aria-hidden />;
  }

  return mpvSupported ? (
    <MpvStage
      src={src}
      autoplay={autoplay}
      resumePosition={resumePosition}
      subtitles={subtitles}
      activeSubId={activeSubId}
      onReady={onReady}
      onWaiting={onWaiting}
      onPlaying={onPlaying}
      onError={onError}
      onProgress={onProgress}
      className={className}
    />
  ) : (
    <NativeStage
      ref={videoRef}
      src={src}
      autoplay={autoplay}
      resumePosition={resumePosition}
      hls={hls}
      crossOrigin={crossOrigin}
      onReady={onReady}
      onWaiting={onWaiting}
      onPlaying={onPlaying}
      onError={onError}
      onProgress={onProgress}
      className={className}
    >
      {children}
    </NativeStage>
  );
});

// --- mpv path -------------------------------------------------------

function MpvStage({
  src,
  autoplay,
  resumePosition,
  subtitles,
  activeSubId,
  onReady,
  onWaiting,
  onPlaying,
  onError,
  onProgress,
  className,
}: {
  src: string | null;
  autoplay: boolean;
  resumePosition?: number;
  subtitles?: VideoStageSubtitle[];
  activeSubId?: string | null;
  onReady?: () => void;
  onWaiting?: () => void;
  onPlaying?: () => void;
  onError?: (info: { code?: number; message?: string }) => void;
  onProgress?: (positionSec: number, durationSec: number) => void;
  className?: string;
}) {
  const playerRef = useRef<MpvPlayerRef | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [controlsVisible, setControlsVisible] = useState(false);

  // Stop playback when the mpv surface unmounts (player closed). mpv is a
  // single shared instance painting into a native NSView — without an explicit
  // stop it keeps decoding the (buffered) audio/video after the window closes,
  // so you'd still hear the movie. `stop` unloads the current file.
  useEffect(() => {
    return () => {
      void mpv.stop().catch(() => {});
      // Leaving the player must not strand the Tauri window in fullscreen.
      // Fullscreen is a window-level state (mpv.toggleFullscreen drives
      // win.setFullscreen), so without this the NEXT player page inherits it
      // via useFullscreen() — e.g. closing a fullscreen movie and opening TV
      // lands you in fullscreen with the previous frame still painted.
      void getCurrentWindow()
        .setFullscreen(false)
        .catch(() => {});
    };
  }, []);

  // Auto-hide controls — Stremio/YouTube windowed-overlay behavior.
  const hideTimerRef = useRef<number | null>(null);
  const armHide = () => {
    setControlsVisible(true);
    if (hideTimerRef.current != null) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => {
      setControlsVisible(false);
      hideTimerRef.current = null;
    }, AUTOHIDE_MS);
  };
  const hideControlsNow = () => {
    setControlsVisible(false);
    if (hideTimerRef.current != null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  };

  // Click toggles play/pause via the typed `pause` setter (the raw `cycle`
  // command isn't in the plugin's default permission set). Double-click
  // toggles fullscreen. 250ms delay keeps the double-click from also
  // flipping play state. Clicks on the bar itself are ignored.
  const clickTimerRef = useRef<number | null>(null);
  const lastPausedRef = useRef<boolean>(true);
  const isInteractiveTarget = (target: EventTarget | null): boolean => {
    if (!(target instanceof HTMLElement)) return false;
    return !!target.closest(
      'button, [role="slider"], [role="button"], input, a, summary, details',
    );
  };
  const handleClick = (e: React.MouseEvent) => {
    if (isInteractiveTarget(e.target)) return;
    if (clickTimerRef.current != null) return;
    const next = !lastPausedRef.current;
    clickTimerRef.current = window.setTimeout(() => {
      void mpv.setProperty("pause", next).catch(() => {});
      clickTimerRef.current = null;
    }, 250);
  };
  const handleDoubleClick = (e: React.MouseEvent) => {
    if (isInteractiveTarget(e.target)) return;
    if (clickTimerRef.current != null) {
      window.clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    void mpv.toggleFullscreen().catch(() => {});
  };

  // Load the source. Track readiness so we apply resume + active subtitle
  // only once a duration arrives (mpv needs a demuxed file first).
  const readyFiredRef = useRef(false);
  const resumedRef = useRef(false);
  // A resume seek lands a tick or two after we issue it; until then mpv still
  // reports the PRE-seek position (~0). `resumeTargetRef` is the position we
  // seeked to; while set we suppress progress emission so the parent doesn't
  // persist that ~0 and clobber the saved resume point. `resumeDeadlineRef`
  // bounds the wait so a seek that never lands (e.g. a torrent that can't yet
  // serve the offset) doesn't block progress saving forever.
  const resumeTargetRef = useRef(0);
  const resumeDeadlineRef = useRef(0);
  const wasPlayingRef = useRef(false);
  // False until THIS src's load() resolves. There's a single shared mpv
  // instance, so before the new file loads, onState still emits the previous
  // video's state (duration>0, its paused flag). Without this gate that
  // stale state fires onReady early (hides the loader → black flash) and
  // poisons the play/pause toggle. We only trust state once our load lands.
  const loadedRef = useRef(false);
  useEffect(() => {
    readyFiredRef.current = false;
    resumedRef.current = false;
    resumeTargetRef.current = 0;
    resumeDeadlineRef.current = 0;
    loadedRef.current = false;
    wasPlayingRef.current = false;
    if (!src) return;
    let cancelled = false;
    // Wait for attach to finish before loading. MpvPlayer kicks off
    // `mpv.attach()` on mount, but it's async — calling load() in the same
    // mount tick races it and fails with "mpv not attached". `mpv.attach()`
    // is idempotent and returns the same in-flight promise, so awaiting it
    // here just sequences load after the native side is ready.
    const t0 = performance.now();
    logger.info("videostage", "load: start", { src });
    (async () => {
      try {
        await mpv.attach();
        if (cancelled) return;
        logger.info("videostage", "load: attached", {
          ms: Math.round(performance.now() - t0),
        });
        await playerRef.current?.load(src, { autoplay });
        if (!cancelled) {
          loadedRef.current = true;
          logger.info("videostage", "load: loadfile issued", {
            ms: Math.round(performance.now() - t0),
          });
        }
      } catch (e) {
        if (!cancelled) {
          logger.error("videostage", "load: failed", { err: String(e) });
          onError?.({ message: String(e) });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  // State subscription → progress + lifecycle callbacks + resume seek.
  useEffect(() => {
    return mpv.onState((s: MpvState) => {
      // Ignore stale state from a previous source until our load resolves.
      if (!loadedRef.current) return;
      if (s.paused != null) lastPausedRef.current = s.paused;
      const dur = s.duration ?? 0;
      const pos = s.time_pos ?? 0;
      if (dur > 0) {
        if (!readyFiredRef.current) {
          readyFiredRef.current = true;
          logger.info("videostage", "first metadata (duration>0)", {
            duration: dur,
          });
          if (resumePosition && resumePosition > 30 && resumePosition < dur - 60) {
            if (!resumedRef.current) {
              resumedRef.current = true;
              resumeTargetRef.current = resumePosition;
              // ~8s for the seek to land before we trust (and persist)
              // whatever position mpv reports.
              resumeDeadlineRef.current = performance.now() + 8000;
              void mpv.seek(resumePosition, "absolute").catch(() => {});
            }
          }
          onReady?.();
        }
        // While a resume seek is in flight mpv briefly still reports the
        // pre-seek position; don't emit it — the parent would persist it and
        // lose the resume point. Stop suppressing once playback reaches the
        // target (within 5s) or the deadline passes.
        if (resumeTargetRef.current > 0) {
          if (
            pos < resumeTargetRef.current - 5 &&
            performance.now() < resumeDeadlineRef.current
          ) {
            return;
          }
          resumeTargetRef.current = 0;
        }
        onProgress?.(pos, dur);
        // Fire onPlaying only on the paused→playing transition, not on every
        // 10Hz state tick.
        const playing = s.paused === false;
        if (playing && !wasPlayingRef.current) onPlaying?.();
        wasPlayingRef.current = playing;
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumePosition]);

  // Buffer underrun → waiting (drives the parent's rebuffering spinner).
  const lastBufLogRef = useRef(0);
  useEffect(() => {
    return mpv.onBuffer((j) => {
      try {
        const o = JSON.parse(j) as {
          underrun?: boolean;
          "cache-duration"?: number;
          "total-bytes"?: number;
          idle?: boolean;
        };
        if (o.underrun) onWaiting?.();
        const now = performance.now();
        if (now - lastBufLogRef.current > 2000) {
          lastBufLogRef.current = now;
          logger.debug("videostage", "buffer", {
            cacheDuration: o["cache-duration"],
            totalBytes: o["total-bytes"],
            idle: o.idle,
            underrun: o.underrun,
            loaded: loadedRef.current,
          });
        }
      } catch {
        /* ignore */
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // External subtitle: add + select the active track once a file is loaded.
  // mpv's overlay bar (Subtitles → Track) also lists added tracks for direct
  // switching. Re-selecting toggles via `sid`.
  const addedSubsRef = useRef<Map<string, boolean>>(new Map());
  useEffect(() => {
    if (!activeSubId) {
      void mpv.setProperty("sid", "no").catch(() => {});
      return;
    }
    const sub = subtitles?.find((s) => s.id === activeSubId);
    if (!sub) return;
    const apply = () => {
      // sub-add appends + selects. We dedupe by URL so toggling doesn't pile
      // up duplicate tracks in the bar; the very first add also selects it.
      if (!addedSubsRef.current.get(sub.url)) {
        addedSubsRef.current.set(sub.url, true);
        void mpv
          .command("sub-add", [sub.url, "select", sub.label ?? "Subtitle", sub.lang])
          .catch(() => {});
      }
    };
    if (readyFiredRef.current) apply();
    else {
      // Wait for the file to demux, then add.
      const off = mpv.onState((s) => {
        if ((s.duration ?? 0) > 0) {
          apply();
          off();
        }
      });
      return off;
    }
  }, [activeSubId, subtitles]);

  // Reset dedupe set when the source changes.
  useEffect(() => {
    addedSubsRef.current = new Map();
  }, [src]);

  return (
    <div
      ref={containerRef}
      data-player-fullscreen-keep
      onMouseEnter={armHide}
      onMouseMove={armHide}
      onMouseLeave={hideControlsNow}
      // CRITICAL: explicit transparent background. mpv paints into a native
      // NSView BELOW the transparent webview. This wrapper is absolutely
      // positioned, which makes WebKit give it its own compositing backing
      // store — and that store defaults to OPAQUE (black), covering the
      // video, unless we force it transparent. MpvPlayer's own div does the
      // same. We also avoid `overflow-hidden` here: a clip on a composited
      // layer over the native view is another way to get an opaque backing.
      style={{ background: "transparent" }}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      className={clsx(
        // Fill via the passed className (parents pass `absolute inset-0` over
        // a `relative` sized wrapper). An absolutely-positioned box also
        // establishes the positioning context for the children below.
        controlsVisible ? "cursor-default" : "cursor-none",
        className,
      )}
    >
      <MpvPlayer ref={playerRef} className="absolute inset-0" />
      <PlayerActionFeedback />
      <div className="absolute inset-0 flex flex-col justify-end">
        <PlayerControls containerRef={containerRef} visible={controlsVisible} />
      </div>
    </div>
  );
}

// --- native fallback ------------------------------------------------

const NativeStage = forwardRef<
  HTMLVideoElement,
  {
    src: string | null;
    autoplay: boolean;
    resumePosition?: number;
    hls: boolean;
    crossOrigin?: string;
    onReady?: () => void;
    onWaiting?: () => void;
    onPlaying?: () => void;
    onError?: (info: { code?: number; message?: string }) => void;
    onProgress?: (positionSec: number, durationSec: number) => void;
    className?: string;
    children?: React.ReactNode;
  }
>(function NativeStage(
  {
    src,
    autoplay,
    resumePosition,
    hls,
    crossOrigin,
    onReady,
    onWaiting,
    onPlaying,
    onError,
    onProgress,
    className,
    children,
  },
  ref,
) {
  const innerRef = useRef<HTMLVideoElement | null>(null);
  const setRefs = (el: HTMLVideoElement | null) => {
    innerRef.current = el;
    if (typeof ref === "function") ref(el);
    else if (ref) ref.current = el;
  };

  // Source loading — direct src, or hls.js when needed.
  useEffect(() => {
    const video = innerRef.current;
    if (!video || !src) return;
    let destroyed = false;
    let hlsInstance: { destroy: () => void } | null = null;

    const init = async () => {
      try {
        const nativeHls = video.canPlayType("application/vnd.apple.mpegurl");
        if (!hls || nativeHls) {
          video.src = src;
          if (autoplay) await video.play().catch(() => {});
          return;
        }
        const Hls = (await import("hls.js")).default;
        if (destroyed) return;
        if (Hls.isSupported()) {
          const instance = new Hls();
          instance.on(Hls.Events.ERROR, (_evt, data) => {
            if (data.fatal)
              onError?.({ message: data.details || data.type || "Playback error" });
          });
          instance.loadSource(src);
          instance.attachMedia(video);
          hlsInstance = instance;
          if (autoplay) await video.play().catch(() => {});
        } else {
          video.src = src;
          if (autoplay) await video.play().catch(() => {});
        }
      } catch (e) {
        if (!destroyed) onError?.({ message: e instanceof Error ? e.message : String(e) });
      }
    };
    init();

    return () => {
      destroyed = true;
      if (hlsInstance) hlsInstance.destroy();
      try {
        video.pause();
        video.removeAttribute("src");
        video.load();
      } catch {
        /* ignore */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, hls]);

  return (
    <video
      ref={setRefs}
      controls
      playsInline
      autoPlay={autoplay}
      crossOrigin={crossOrigin as "" | "anonymous" | "use-credentials" | undefined}
      className={clsx("bg-black object-contain", className)}
      onLoadedMetadata={() => {
        const v = innerRef.current;
        if (!v) return;
        if (
          resumePosition &&
          resumePosition > 30 &&
          Number.isFinite(v.duration) &&
          resumePosition < v.duration - 60
        ) {
          v.currentTime = resumePosition;
        }
      }}
      onCanPlay={() => onReady?.()}
      onWaiting={() => onWaiting?.()}
      onPlaying={() => onPlaying?.()}
      onTimeUpdate={() => {
        const v = innerRef.current;
        if (v && Number.isFinite(v.duration)) onProgress?.(v.currentTime, v.duration);
      }}
      onError={(e) => {
        const v = e.currentTarget as HTMLVideoElement;
        onError?.({ code: v.error?.code, message: v.error?.message });
      }}
    >
      {children}
    </video>
  );
});
