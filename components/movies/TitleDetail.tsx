"use client";
import { useMemo, useState } from "react";
import {
  Play,
  Heart,
  Calendar,
  Clock,
  Tag,
  Star,
  Loader2,
  Film,
  List,
  LayoutGrid,
  Check,
} from "lucide-react";
import clsx from "clsx";
import type { CatalogItem, EpisodeMeta, Meta, Stream } from "@/lib/movies/types";
import StreamPicker from "./StreamPicker";
import MediaLoader from "@/components/MediaLoader";

// Remembered across sessions, shared by Movies + Anime episode lists.
const EPISODE_VIEW_KEY = "mosaic.media.episodeView";

type Props = {
  item: CatalogItem;
  meta: Meta | null;
  metaLoading: boolean;
  streams: Stream[];
  streamsLoading: boolean;
  activeStreamIndex: number;
  onPickStream: (idx: number) => void;
  onPlay: () => void;
  // Series-only:
  selectedSeason: number | null;
  selectedEpisode: EpisodeMeta | null;
  onPickEpisode: (ep: EpisodeMeta) => void;
  // Episode ids the user has finished / has in-progress — drive the watched
  // markers in both episode views. Optional so Movies (which doesn't track this
  // yet) keeps working unchanged.
  watchedEpisodeIds?: Set<string>;
  inProgressEpisodeIds?: Set<string>;
  // Manually toggle an episode's watched state (right-click / checkbox).
  onToggleWatched?: (ep: EpisodeMeta) => void;

  isFavorite: boolean;
  onToggleFavorite: () => void;
};

export default function TitleDetail({
  item,
  meta,
  metaLoading,
  streams,
  streamsLoading,
  activeStreamIndex,
  onPickStream,
  onPlay,
  selectedSeason,
  selectedEpisode,
  onPickEpisode,
  watchedEpisodeIds,
  inProgressEpisodeIds,
  onToggleWatched,
  isFavorite,
  onToggleFavorite,
}: Props) {
  const seasons = useMemo(() => {
    if (item.type !== "series" || !meta?.videos) return [] as number[];
    const set = new Set<number>();
    for (const v of meta.videos) {
      if (typeof v.season === "number" && v.season > 0) set.add(v.season);
    }
    return [...set].sort((a, b) => a - b);
  }, [meta, item.type]);

  const [seasonTab, setSeasonTab] = useState<number | null>(
    selectedSeason ?? seasons[0] ?? null,
  );
  // Episode layout: rich "list" (thumbnail + title + synopsis) or a compact
  // "grid" of numbered squares — far easier to scan for long runners. The
  // choice is remembered across sessions (shared by Movies + Anime). Safe to
  // read localStorage in the initializer: this component only ever mounts on
  // the client (inside a portal opened on user interaction).
  const [epView, setEpView] = useState<"list" | "grid">(() => {
    try {
      return localStorage.getItem(EPISODE_VIEW_KEY) === "grid" ? "grid" : "list";
    } catch {
      return "list";
    }
  });
  const changeEpView = (mode: "list" | "grid") => {
    setEpView(mode);
    try {
      localStorage.setItem(EPISODE_VIEW_KEY, mode);
    } catch {
      /* best-effort */
    }
  };
  // Auto-pick first available season when meta first arrives.
  if (seasonTab == null && seasons.length > 0) {
    setSeasonTab(seasons[0]);
  }

  const episodes = useMemo(() => {
    if (item.type !== "series" || !meta?.videos || seasonTab == null) return [];
    return meta.videos
      .filter((v) => v.season === seasonTab && v.episode > 0)
      .sort((a, b) => a.episode - b.episode);
  }, [meta, item.type, seasonTab]);

  // Trailer (YouTube id from Cinemeta). `trailers[].source` is the standard
  // field; some responses only carry `trailerStreams[].ytId`, so fall back.
  const trailerId = useMemo(() => {
    const fromTrailers =
      meta?.trailers?.find((t) => /trailer/i.test(t.type))?.source ??
      meta?.trailers?.[0]?.source;
    if (fromTrailers) return fromTrailers;
    const streams = (meta as { trailerStreams?: { ytId?: string }[] } | null)
      ?.trailerStreams;
    return streams?.[0]?.ytId ?? null;
  }, [meta]);

  return (
    <div className="relative rounded-2xl overflow-hidden bg-neutral-950/80 ring-1 ring-white/10 shadow-2xl shadow-black/60 flex flex-col h-full">
      {/* Hero with backdrop */}
      <div className="relative h-[280px] md:h-[340px] bg-neutral-950 overflow-hidden shrink-0">
        {(meta?.background ?? item.background) && (
          <img
            src={meta?.background ?? item.background ?? undefined}
            alt=""
            className="absolute inset-0 w-full h-full object-cover object-top opacity-60 scale-[1.03]"
          />
        )}
        {/* Layered scrims: bottom for the text plate, a left wash for legibility
            over the poster, and a faint top fade — cinematic, not muddy. */}
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/55 to-black/10" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/75 via-black/10 to-transparent" />
        <div className="relative h-full px-5 md:px-7 pb-5 md:pb-6 flex items-end gap-5">
          {item.poster && (
            <img
              src={item.poster}
              alt={item.name}
              className="hidden md:block w-[124px] aspect-[2/3] object-cover rounded-xl ring-1 ring-white/15 shadow-2xl shadow-black/70"
            />
          )}
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl md:text-[28px] font-semibold tracking-tight text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.6)] leading-tight">
              {item.name}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[12px] text-neutral-300">
              {(meta?.releaseInfo ?? item.releaseInfo) && (
                <span className="inline-flex items-center gap-1">
                  <Calendar size={11} />
                  {meta?.releaseInfo ?? item.releaseInfo}
                </span>
              )}
              {(meta?.runtime ?? item.runtime) && (
                <span className="inline-flex items-center gap-1">
                  <Clock size={11} />
                  {meta?.runtime ?? item.runtime}
                </span>
              )}
              {(meta?.imdbRating ?? item.imdbRating) && (
                <span className="inline-flex items-center gap-1.5">
                  <span className="px-1 py-0.5 rounded-[3px] bg-[#f5c518] text-black font-bold text-[9px] leading-none tracking-wide">
                    IMDb
                  </span>
                  <span className="inline-flex items-center gap-1 text-amber-200">
                    <Star size={11} fill="currentColor" />
                    {meta?.imdbRating ?? item.imdbRating}
                    <span className="text-neutral-400">/10</span>
                  </span>
                </span>
              )}
              {(meta?.genres ?? item.genres)?.slice(0, 3).map((g) => (
                <span
                  key={g}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/[0.08] ring-1 ring-white/10 text-[10.5px] text-neutral-200"
                >
                  <Tag size={9} className="opacity-60" />
                  {g}
                </span>
              ))}
            </div>

            {item.type === "movie" && (
              <div className="mt-4 flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  onClick={onPlay}
                  disabled={streams.length === 0 || streamsLoading}
                  className={clsx(
                    "inline-flex items-center gap-2 px-5 py-2 rounded-xl text-[13.5px] font-semibold transition-all",
                    streams.length > 0 && !streamsLoading
                      ? "bg-white text-black hover:bg-white/90 shadow-lg shadow-black/30 hover:scale-[1.02] active:scale-100"
                      : "bg-white/10 text-neutral-400 cursor-not-allowed",
                  )}
                >
                  {streamsLoading ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <Play size={15} fill="currentColor" />
                  )}
                  Play
                </button>
                <button
                  type="button"
                  onClick={onToggleFavorite}
                  aria-pressed={isFavorite}
                  className={clsx(
                    "inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[13px] font-medium ring-1 backdrop-blur-sm transition-colors",
                    isFavorite
                      ? "bg-rose-500/15 ring-rose-400/40 text-rose-200 hover:bg-rose-500/25"
                      : "bg-white/5 ring-white/10 text-neutral-200 hover:bg-white/10",
                  )}
                >
                  <Heart size={14} fill={isFavorite ? "currentColor" : "none"} />
                  {isFavorite ? "Saved" : "Save"}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="p-4 md:p-5 grid gap-5 md:grid-cols-[1fr_minmax(280px,360px)] flex-1 min-h-0">
        {/* Left: synopsis + (series only) episode list */}
        <div className="space-y-5 min-w-0 overflow-y-auto pr-1">
          {metaLoading && !meta ? (
            <div className="grid place-items-center min-h-[240px] py-10">
              <MediaLoader label="Loading details…" />
            </div>
          ) : (
            <div className="space-y-1.5">
              <div className="text-[10.5px] font-medium uppercase tracking-[0.16em] text-neutral-500">
                Overview
              </div>
              <p className="text-[13.5px] text-neutral-300/90 leading-relaxed max-w-prose">
                {meta?.description ??
                  item.description ??
                  "No description available."}
              </p>
            </div>
          )}

          {/* Inline trailer — fills the left column. Plays in-place (a plain
              youtube.com/embed iframe, no iframe_api, to dodge the Tauri
              parent-origin rejection). For movies we also show a placeholder
              when there's no trailer; for series the episode list fills the
              space so we only show the player when a trailer exists. */}
          {!(metaLoading && !meta) && (trailerId || item.type === "movie") && (
            <div className="space-y-1.5">
              <div className="text-[10.5px] font-medium uppercase tracking-[0.16em] text-neutral-500">
                Trailer
              </div>
              {trailerId ? (
                <div className="aspect-video w-full rounded-2xl overflow-hidden ring-1 ring-white/10 bg-black shadow-lg shadow-black/40">
                  <iframe
                    src={`https://www.youtube.com/embed/${encodeURIComponent(
                      trailerId,
                    )}?rel=0&playsinline=1`}
                    title="Trailer"
                    className="w-full h-full"
                    frameBorder="0"
                    referrerPolicy="strict-origin-when-cross-origin"
                    allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                    allowFullScreen
                  />
                </div>
              ) : (
                <div className="aspect-video w-full rounded-2xl ring-1 ring-white/10 bg-gradient-to-br from-white/[0.04] to-transparent grid place-items-center">
                  <div className="flex flex-col items-center gap-2 text-neutral-500">
                    <Film size={22} className="opacity-50" />
                    <span className="text-[12.5px]">No trailer found</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {item.type === "series" && seasons.length > 0 && (
            <div>
              <div className="flex items-center justify-between gap-2 mb-2">
                {/* Season tabs only make sense when there's more than one season
                    — most anime live under a single synthetic season, so we show
                    a plain "Episodes" label instead. */}
                {seasons.length > 1 ? (
                  <div className="flex flex-wrap gap-1 min-w-0">
                    {seasons.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setSeasonTab(s)}
                        className={clsx(
                          "px-2.5 py-1 rounded-md text-[11.5px] border transition-colors",
                          seasonTab === s
                            ? "bg-violet-500/25 border-violet-400/50 text-violet-100"
                            : "bg-white/[0.03] border-white/10 text-neutral-300 hover:bg-white/[0.07]",
                        )}
                      >
                        Season {s}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="text-[10.5px] font-medium uppercase tracking-[0.16em] text-neutral-500">
                    Episodes
                  </div>
                )}
                {/* List / Grid view toggle */}
                <div className="inline-flex shrink-0 items-center bg-white/[0.04] border border-white/10 rounded-lg p-0.5">
                  {([
                    { mode: "list" as const, Icon: List, label: "List view" },
                    { mode: "grid" as const, Icon: LayoutGrid, label: "Grid view" },
                  ]).map(({ mode, Icon, label }) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => changeEpView(mode)}
                      aria-label={label}
                      aria-pressed={epView === mode}
                      title={label}
                      className={clsx(
                        "grid place-items-center w-6 h-6 rounded-md transition-colors",
                        epView === mode
                          ? "bg-white/[0.12] text-white"
                          : "text-neutral-400 hover:text-white",
                      )}
                    >
                      <Icon size={13} />
                    </button>
                  ))}
                </div>
              </div>

              {epView === "grid" ? (
                <div className="grid gap-1.5 grid-cols-[repeat(auto-fill,minmax(54px,1fr))] max-h-[360px] overflow-y-auto pr-1">
                  {episodes.map((ep) => {
                    const active = selectedEpisode?.id === ep.id;
                    const watched = watchedEpisodeIds?.has(ep.id) ?? false;
                    const inProgress =
                      !watched && (inProgressEpisodeIds?.has(ep.id) ?? false);
                    return (
                      <button
                        key={ep.id}
                        type="button"
                        onClick={() => onPickEpisode(ep)}
                        onContextMenu={
                          onToggleWatched
                            ? (e) => {
                                e.preventDefault();
                                onToggleWatched(ep);
                              }
                            : undefined
                        }
                        title={`E${ep.episode}${
                          ep.name ?? ep.title ? ` · ${ep.name ?? ep.title}` : ""
                        }${watched ? " · watched" : ""}${
                          onToggleWatched ? " — right-click to toggle watched" : ""
                        }`}
                        className={clsx(
                          "relative h-10 grid place-items-center rounded-md border text-[12.5px] font-medium tabular-nums transition-colors",
                          active
                            ? "bg-violet-500/25 border-violet-400/60 text-violet-100"
                            : watched
                              ? "bg-emerald-500/15 border-emerald-400/40 text-emerald-200/90"
                              : inProgress
                                ? "bg-amber-500/[0.12] border-amber-400/40 text-amber-100/90"
                                : "bg-white/[0.03] border-white/10 text-neutral-300 hover:bg-white/[0.08] hover:text-white",
                        )}
                      >
                        {ep.episode}
                        {watched && (
                          <span className="absolute top-0.5 right-0.5 grid place-items-center w-3.5 h-3.5 rounded-full bg-emerald-500 text-white">
                            <Check size={9} strokeWidth={3} />
                          </span>
                        )}
                        {inProgress && (
                          <span className="absolute bottom-1 left-1 right-1 h-0.5 rounded-full bg-amber-400/80" />
                        )}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="space-y-1 max-h-[360px] overflow-y-auto pr-1">
                  {episodes.map((ep) => {
                    const active = selectedEpisode?.id === ep.id;
                    const watched = watchedEpisodeIds?.has(ep.id) ?? false;
                    const inProgress =
                      !watched && (inProgressEpisodeIds?.has(ep.id) ?? false);
                    return (
                      <button
                        key={ep.id}
                        type="button"
                        onClick={() => onPickEpisode(ep)}
                        onContextMenu={
                          onToggleWatched
                            ? (e) => {
                                e.preventDefault();
                                onToggleWatched(ep);
                              }
                            : undefined
                        }
                        className={clsx(
                          "w-full flex items-start gap-3 p-2 rounded-lg border text-left transition-colors",
                          active
                            ? "bg-violet-500/15 border-violet-400/40"
                            : watched
                              ? "bg-emerald-500/[0.07] border-emerald-400/20 hover:bg-emerald-500/[0.12]"
                              : "bg-white/[0.02] border-white/5 hover:bg-white/[0.06] hover:border-white/10",
                        )}
                      >
                        {ep.thumbnail && (
                          <img
                            src={ep.thumbnail}
                            alt=""
                            className={clsx(
                              "w-20 aspect-video object-cover rounded shrink-0",
                              watched && "opacity-60",
                            )}
                            loading="lazy"
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="text-[12.5px] font-medium text-white truncate flex items-center gap-1.5">
                            {watched && (
                              <span className="grid place-items-center w-4 h-4 rounded-full bg-emerald-500 text-white shrink-0">
                                <Check size={10} strokeWidth={3} />
                              </span>
                            )}
                            <span className="text-neutral-500 mr-1">
                              E{ep.episode}
                            </span>
                            <span className="truncate">
                              {ep.name ?? ep.title ?? `Episode ${ep.episode}`}
                            </span>
                          </div>
                          {ep.overview && (
                            <div className="text-[11px] text-neutral-400 line-clamp-2 mt-0.5">
                              {ep.overview}
                            </div>
                          )}
                          {inProgress && (
                            <div className="mt-1 h-0.5 w-full rounded-full bg-amber-400/70" />
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right: stream picker — the only scrollable area in the detail
            view, so the hero/title/synopsis stay in place while the user
            browses dozens of stream sources. */}
        <div className="min-w-0 flex flex-col min-h-0">
          <div className="text-[10.5px] font-medium uppercase tracking-[0.16em] text-neutral-500 mb-2 px-1 flex items-center justify-between shrink-0">
            <span>Streams</span>
            {streamsLoading && (
              <Loader2 size={12} className="animate-spin text-neutral-400" />
            )}
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto pr-1">
            {streamsLoading && streams.length === 0 ? (
              <div className="grid place-items-center h-full min-h-[200px]">
                <MediaLoader label="Finding streams…" size={40} />
              </div>
            ) : (
              <StreamPicker
                streams={streams}
                activeIndex={activeStreamIndex}
                onPick={onPickStream}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
