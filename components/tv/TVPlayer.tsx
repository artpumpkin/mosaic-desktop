"use client";
import { useEffect, useRef, useState } from "react";
import {
  Maximize2,
  Minimize2,
  AlertTriangle,
  PictureInPicture2,
  SkipBack,
  SkipForward,
  Shuffle,
  Heart,
  ChevronDown,
  Check,
} from "lucide-react";
import clsx from "clsx";
import type { TvChannel, TvStream } from "@/lib/tv/types";
import type { MediaKind } from "@/lib/tv/storage";
import { VideoStage, type VideoStageHandle } from "@/components/player/VideoStage";
import RadioPlayer from "./RadioPlayer";
import { useMpvSupported } from "@/lib/player/platform";
import { mpv } from "@artpumpkin/mpv-player";

export type ScopeOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

export type ScopeControl = {
  /** Current scope's short label, e.g. "Favorites" or "News". */
  label: string;
  /** Value of the active option (matches one of options[].value). */
  value: string;
  options: ScopeOption[];
  onChange: (value: string) => void;
};

type Props = {
  channel: TvChannel;
  streams: TvStream[];
  countryFlag?: string;
  isFavorite?: boolean;
  onToggleFavorite?: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  onShuffle?: () => void;
  scope?: ScopeControl;
  /** Fill the parent's height (stage flexes + letterboxes) instead of forcing
   * a 16:9 box. Lets the player sit in a fixed, no-scroll column. */
  fill?: boolean;
  /** "radio" swaps the video stage for an animated now-playing visualization
   * (the stream still plays — it's just audio). Defaults to "tv". */
  mediaKind?: MediaKind;
  /** Friendly genre label shown on the radio stage. */
  genreLabel?: string | null;
};

// Webkit-specific augmentations: Safari + older WebKit-based Tauri webviews
// still expose the prefixed Fullscreen API.
type WebkitDoc = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type WebkitVideo = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void;
  webkitSupportsFullscreen?: boolean;
  webkitRequestFullscreen?: () => Promise<void> | void;
};

function getFullscreenElement(): Element | null {
  const d = document as WebkitDoc;
  return document.fullscreenElement ?? d.webkitFullscreenElement ?? null;
}

export default function TVPlayer({
  channel,
  streams,
  countryFlag,
  isFavorite = false,
  onToggleFavorite,
  onPrev,
  onNext,
  onShuffle,
  scope,
  fill = false,
  mediaKind = "tv",
  genreLabel,
}: Props) {
  const isRadio = mediaKind === "radio";
  const stageRef = useRef<VideoStageHandle | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const scopeRef = useRef<HTMLDivElement | null>(null);
  const mpvSupported = useMpvSupported();
  const getVideoEl = () => stageRef.current?.getVideoEl() ?? null;
  const [activeIdx, setActiveIdx] = useState(0);
  const [scopeOpen, setScopeOpen] = useState(false);

  useEffect(() => {
    if (!scopeOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!scopeRef.current?.contains(e.target as Node)) setScopeOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setScopeOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [scopeOpen]);
  const [error, setError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // CSS-overlay fullscreen — kicks in when the native Fullscreen API isn't
  // available (e.g. Tauri's WebView often returns "Fullscreen not supported").
  // We never destroy the <video> element so HLS playback keeps streaming.
  const [pseudoFs, setPseudoFs] = useState(false);
  const fsActive = isFullscreen || pseudoFs;

  // Reset to first stream whenever the channel changes.
  useEffect(() => {
    setActiveIdx(0);
  }, [channel.id]);

  const active = streams[activeIdx] ?? streams[0];

  // Clear any prior error when the selected stream changes — VideoStage owns
  // source loading (mpv plays HLS natively; the native fallback uses hls.js).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError(null);
  }, [active]);


  useEffect(() => {
    const handler = () => setIsFullscreen(!!getFullscreenElement());
    document.addEventListener("fullscreenchange", handler);
    document.addEventListener("webkitfullscreenchange", handler);
    return () => {
      document.removeEventListener("fullscreenchange", handler);
      document.removeEventListener("webkitfullscreenchange", handler);
    };
  }, []);

  // Exit pseudo-fullscreen on ESC, matching what users expect from native FS.
  useEffect(() => {
    if (!pseudoFs) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPseudoFs(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [pseudoFs]);

  // Fullscreen strategy: try native APIs on the <video> first, then on the
  // wrapper. If all of those refuse (common in Tauri's WebView), drop into
  // a CSS-only overlay that lifts the stage to position:fixed inset-0. The
  // video element is never re-parented so HLS keeps decoding seamlessly.
  const toggleFullscreen = async () => {
    // Radio has no <video> and doesn't use mpv — just toggle the CSS overlay
    // so the visualization fills the screen.
    if (isRadio) {
      setPseudoFs((v) => !v);
      return;
    }
    // mpv owns real fullscreen (drives the Tauri window); no <video> exists
    // to fullscreen on that path.
    if (mpvSupported) {
      await mpv.toggleFullscreen().catch(() => {});
      return;
    }
    if (pseudoFs) {
      setPseudoFs(false);
      return;
    }

    const fsEl = getFullscreenElement();
    if (fsEl) {
      try {
        const d = document as WebkitDoc;
        if (document.exitFullscreen) await document.exitFullscreen();
        else if (d.webkitExitFullscreen) await d.webkitExitFullscreen();
      } catch {
        /* ignore */
      }
      return;
    }

    const video = getVideoEl() as WebkitVideo | null;
    if (!video) return;

    // 1. iOS Safari only.
    if (video.webkitEnterFullscreen) {
      try {
        video.webkitEnterFullscreen();
        return;
      } catch {
        /* fall through */
      }
    }
    // 2. Standard API on the video element.
    if (video.requestFullscreen) {
      try {
        await video.requestFullscreen();
        return;
      } catch {
        /* fall through */
      }
    }
    // 3. Prefixed API on the video element.
    if (video.webkitRequestFullscreen) {
      try {
        await video.webkitRequestFullscreen();
        return;
      } catch {
        /* fall through */
      }
    }
    // 4. Last resort: CSS overlay. Always works.
    setPseudoFs(true);
  };

  const togglePip = async () => {
    const video = getVideoEl();
    if (!video) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if ("requestPictureInPicture" in video) {
        await video.requestPictureInPicture();
      }
    } catch {
      /* ignore */
    }
  };

  const needsCustomHeaders = !!(active?.user_agent || active?.referrer);
  const categoryLabel = channel.categories.slice(0, 2).join(" · ");

  return (
    <div
      className={clsx(
        // `rounded-2xl` (border radius only) + `shadow-2xl` are compositing-
        // safe over the native mpv view: the radius doesn't clip without
        // `overflow-hidden`, and the shadow paints outside the box. The two
        // things that DID cover the video — `overflow-hidden` (a rounded clip
        // mask over the video rect) and an opaque background — stay on the
        // native <video> path only.
        "border border-white/5 flex flex-col rounded-2xl shadow-2xl shadow-black/50",
        fill && "h-full min-h-0",
        mpvSupported ? "" : "overflow-hidden bg-black/40",
      )}
    >
      {/* Title strip: channel identity lives ABOVE the video so the picture
          stays unobstructed. PIP / fullscreen actions sit on the right. */}
      <div className="flex items-center gap-3 px-3.5 md:px-4 py-2.5 border-b border-white/5 bg-gradient-to-b from-white/[0.04] to-transparent rounded-t-2xl">
        {channel.logo && (
          <img
            src={channel.logo}
            alt=""
            className="w-9 h-9 rounded-md object-contain bg-black/40 shrink-0"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
            }}
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 leading-tight">
            <h2 className="text-[14.5px] font-semibold text-white truncate">
              {channel.name}
            </h2>
            <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-rose-300 bg-rose-500/15 border border-rose-400/30 rounded-full px-1.5 py-0.5 shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
              LIVE
            </span>
          </div>
          <div className="text-[11px] text-neutral-400 truncate flex items-center gap-1.5 mt-0.5">
            {countryFlag && <span aria-hidden>{countryFlag}</span>}
            <span>{channel.country}</span>
            {categoryLabel && (
              <>
                <span className="opacity-40">·</span>
                <span className="truncate capitalize">{categoryLabel}</span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {onToggleFavorite && (
            <button
              type="button"
              onClick={onToggleFavorite}
              aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
              aria-pressed={isFavorite}
              title={isFavorite ? "Remove from favorites" : "Add to favorites"}
              className={clsx(
                "p-1.5 rounded-md transition-colors",
                isFavorite
                  ? "text-rose-400 hover:text-rose-300 hover:bg-rose-500/10"
                  : "text-neutral-400 hover:text-rose-300 hover:bg-white/10",
              )}
            >
              <Heart
                size={15}
                strokeWidth={2}
                fill={isFavorite ? "currentColor" : "none"}
              />
            </button>
          )}
          {/* Browser PiP only exists on the native <video> path; mpv has no
              PiP under vo=libmpv. */}
          {!mpvSupported && (
            <button
              type="button"
              onClick={togglePip}
              className="p-1.5 rounded-md text-neutral-400 hover:text-white hover:bg-white/10"
              aria-label="Picture in picture"
              title="Picture in picture"
            >
              <PictureInPicture2 size={15} />
            </button>
          )}
          <button
            type="button"
            onClick={toggleFullscreen}
            className="p-1.5 rounded-md text-neutral-400 hover:text-white hover:bg-white/10"
            aria-label={fsActive ? "Exit fullscreen" : "Fullscreen channel"}
            title="Fullscreen channel"
          >
            {fsActive ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
        </div>
      </div>

      {/* Stage: pure video, no overlays. In pseudo-fullscreen we lift to a
          fixed inset-0 overlay; otherwise the stage is a 16:9 box filling
          the parent's width. The <video> node is never re-parented, so HLS
          playback survives the mode swap. */}
      <div
        ref={wrapRef}
        className={clsx(
          // Transparent on the mpv path (the video shows through from the
          // native layer below); black letterbox on the native path.
          mpvSupported ? "" : "bg-black",
          pseudoFs
            ? "fixed inset-0 z-[9999] w-screen h-screen aspect-auto"
            : fill
              ? "relative w-full flex-1 min-h-0"
              : "relative w-full aspect-video mx-auto",
        )}
      >
        {isRadio ? (
          // Radio plays through its own <audio> + Web Audio analyser (so the
          // visualization can read the real spectrum) — mpv/VideoStage isn't
          // used at all on this path.
          <RadioPlayer
            channel={channel}
            stream={active}
            countryFlag={countryFlag}
            genreLabel={genreLabel}
            onError={(msg) => setError(msg)}
          />
        ) : (
          <VideoStage
            ref={stageRef}
            src={active?.url ?? null}
            hls
            onError={(info) => setError(info.message ?? "Playback error")}
            className="absolute inset-0"
          />
        )}
        {pseudoFs && (
          <button
            type="button"
            onClick={() => setPseudoFs(false)}
            className="absolute top-3 right-3 z-10 grid place-items-center w-9 h-9 rounded-full bg-black/70 hover:bg-black/90 text-white border border-white/10 backdrop-blur"
            aria-label="Exit fullscreen"
            title="Exit fullscreen (Esc)"
          >
            <Minimize2 size={16} />
          </button>
        )}
      </div>

      {/* Footer: prev / shuffle / next + source switcher + status hints. */}
      {(onPrev || onNext || onShuffle || streams.length > 1 || needsCustomHeaders || error) && (
        <div className="px-3 md:px-4 py-2.5 border-t border-white/5 flex flex-wrap items-center gap-2 rounded-b-2xl">
          {(onPrev || onShuffle || onNext) && (
            <div className="flex items-center gap-1">
              {onPrev && (
                <button
                  type="button"
                  onClick={onPrev}
                  className="p-1.5 rounded-md text-neutral-400 hover:text-white hover:bg-white/10"
                  title={scope ? `Previous in ${scope.label}` : "Previous channel"}
                  aria-label="Previous channel"
                >
                  <SkipBack size={15} />
                </button>
              )}
              {onShuffle && (
                <button
                  type="button"
                  onClick={onShuffle}
                  className="p-1.5 rounded-md text-neutral-400 hover:text-white hover:bg-white/10"
                  title={scope ? `Random in ${scope.label}` : "Random channel"}
                  aria-label="Random channel"
                >
                  <Shuffle size={15} />
                </button>
              )}
              {onNext && (
                <button
                  type="button"
                  onClick={onNext}
                  className="p-1.5 rounded-md text-neutral-400 hover:text-white hover:bg-white/10"
                  title={scope ? `Next in ${scope.label}` : "Next channel"}
                  aria-label="Next channel"
                >
                  <SkipForward size={15} />
                </button>
              )}
              {scope && (
                <div ref={scopeRef} className="relative ml-1">
                  <button
                    type="button"
                    onClick={() => setScopeOpen((v) => !v)}
                    className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] bg-white/[0.04] border border-white/10 text-neutral-300 hover:bg-white/[0.08] hover:text-white"
                    aria-haspopup="listbox"
                    aria-expanded={scopeOpen}
                    title="Change navigation scope"
                  >
                    <span className="text-neutral-500">Next in</span>
                    <span className="font-medium">{scope.label}</span>
                    <ChevronDown size={12} className="text-neutral-500" />
                  </button>
                  {scopeOpen && (
                    // Opens UPWARD: the player's outer wrapper uses
                    // `overflow-hidden` to round the corners, which clips any
                    // dropdown opening downward inside the footer. Floating up
                    // over the lower edge of the video is fine and stays
                    // inside the rounded box.
                    <div
                      role="listbox"
                      className="absolute left-0 bottom-[calc(100%+4px)] z-30 min-w-[180px] rounded-lg border border-white/10 bg-neutral-900/95 backdrop-blur shadow-xl py-1"
                    >
                      {scope.options.map((opt) => {
                        const selected = opt.value === scope.value;
                        return (
                          <button
                            key={opt.value}
                            type="button"
                            role="option"
                            aria-selected={selected}
                            disabled={opt.disabled}
                            onClick={() => {
                              scope.onChange(opt.value);
                              setScopeOpen(false);
                            }}
                            className={clsx(
                              "w-full flex items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors",
                              opt.disabled
                                ? "text-neutral-600 cursor-not-allowed"
                                : selected
                                ? "text-white bg-white/[0.06]"
                                : "text-neutral-300 hover:bg-white/[0.05] hover:text-white",
                            )}
                          >
                            <Check
                              size={12}
                              className={clsx(
                                "shrink-0",
                                selected ? "text-violet-400" : "opacity-0",
                              )}
                            />
                            <span className="flex-1">{opt.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
              <span className="w-px h-5 bg-white/10 mx-1" />
            </div>
          )}

          {streams.length > 1 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-wider text-neutral-500">
                Source
              </span>
              {streams.map((s, i) => (
                <button
                  key={`${s.url}-${i}`}
                  type="button"
                  onClick={() => setActiveIdx(i)}
                  className={clsx(
                    "px-2 py-0.5 rounded-md text-[11px] border transition-colors",
                    i === activeIdx
                      ? "bg-violet-500/25 border-violet-400/50 text-violet-100"
                      : "bg-white/[0.03] border-white/10 text-neutral-400 hover:bg-white/[0.06]",
                  )}
                >
                  {s.quality || s.title || `${i + 1}`}
                </button>
              ))}
            </div>
          )}

          <div className="flex-1" />

          {needsCustomHeaders && (
            <div
              className="flex items-center gap-1.5 text-[10.5px] text-amber-300/90"
              title="This stream sets User-Agent or Referer headers that browsers can't override — it may not load."
            >
              <AlertTriangle size={12} />
              <span>Restricted headers</span>
            </div>
          )}
          {error && (
            <div className="text-[10.5px] text-rose-300/90 truncate max-w-[300px]" title={error}>
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
