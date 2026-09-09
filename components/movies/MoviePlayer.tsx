"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Maximize2,
  Minimize2,
  AlertTriangle,
  PictureInPicture2,
  Heart,
  X,
  Download,
  Loader2,
  Upload,
  Users,
  Bug,
  Copy,
  Trash2,
} from "lucide-react";
import clsx from "clsx";
import { invoke } from "@tauri-apps/api/core";
import { appCacheDir, join } from "@tauri-apps/api/path";
import type { Stream, Subtitle, WatchProgress } from "@/lib/movies/types";
import {
  resolveStreamUrl,
  stopTorrent,
  torrentStatus,
  torrentHttpBase,
  toMpvStreamUrl,
} from "@/lib/movies/torrentio";
import {
  VideoStage,
  type VideoStageHandle,
  type VideoStageSubtitle,
} from "@/components/player/VideoStage";
import { useMpvSupported } from "@/lib/player/platform";
import { mpv } from "@artpumpkin/mpv-player";
import { exportAll, formatEntry, logger, type LogEntry } from "@/lib/logger";
import {
  fetchSubtitles,
  loadSubtitleAsVttBlob,
  langLabel,
  srtToVtt,
} from "@/lib/movies/opensubtitles";
import {
  getProgress,
  saveProgress,
  throttledSaver,
  updateTrackPrefs,
} from "@/lib/movies/progress";
import type { PlayerProgressStore } from "@/lib/media/watchProgressStore";
import { toast } from "@/lib/toast";

// Default persistence target: the Movies store. Other video sections (Anime,
// …) inject their own store via the `store` prop so their progress lands in
// their own namespace instead of mixing into Movies' continue-watching.
const MOVIES_PROGRESS_STORE: PlayerProgressStore = {
  getProgress,
  saveProgress,
  throttledSaver,
  updateTrackPrefs,
};

type Props = {
  // Display
  title: string;
  subtitle?: string; // year · runtime · etc.
  // What to play
  stream: Stream;
  // Subtitle search id ("ttXXXX" or "ttXXXX:S:E")
  subtitleSearchId: string;
  // Progress key (id used for localStorage progress map)
  progressKey: string;
  progressType: WatchProgress["type"];
  // Poster persisted with the progress entry (used by Continue watching rail)
  persistPoster?: string | null;
  // For series: human-readable episode label persisted with progress.
  persistEpisodeLabel?: string;
  persistSeriesId?: string;
  isFavorite?: boolean;
  onToggleFavorite?: () => void;
  // Close the player overlay (return to detail).
  onClose: () => void;
  // Optional: when playback fails (404s, unsupported codec, etc.), switch
  // to the next ranked stream. Returning `true` tells MoviePlayer that a
  // fallback was taken — it will keep the loading overlay up; returning
  // `false` (no more candidates) surfaces the error.
  onTryNextStream?: () => boolean;
  // Total number of stream sources, for the "source X of N" label.
  streamCount?: number;
  // 0-based index of the current source.
  streamIndex?: number;
  // Persistence target. Defaults to the Movies store; Anime (and future video
  // sections) inject their own so progress stays in their namespace.
  store?: PlayerProgressStore;
};

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

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export default function MoviePlayer({
  title,
  subtitle,
  stream,
  subtitleSearchId,
  progressKey,
  progressType,
  persistPoster,
  persistEpisodeLabel,
  persistSeriesId,
  isFavorite = false,
  onToggleFavorite,
  onClose,
  onTryNextStream,
  streamCount,
  streamIndex,
  store = MOVIES_PROGRESS_STORE,
}: Props) {
  const stageRef = useRef<VideoStageHandle | null>(null);
  const getVideoEl = () => stageRef.current?.getVideoEl() ?? null;
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const mpvSupported = useMpvSupported();
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  // Base URL of the local torrent HTTP server (libmpv path only). libmpv
  // can't read the torrent-stream:// scheme, so on macOS we rewrite the
  // stream URL's prefix to this http://127.0.0.1:port base.
  const [httpBase, setHttpBase] = useState("");
  useEffect(() => {
    if (mpvSupported) torrentHttpBase().then(setHttpBase).catch(() => {});
  }, [mpvSupported]);
  // Temp-file paths for user-uploaded subtitle files, written to disk so
  // libmpv (which can't read blob: URLs) can load them via sub-add.
  const [customMpvPaths, setCustomMpvPaths] = useState<Record<string, string>>(
    {},
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // True until the <video> fires `canplay` — used to keep the loading
  // overlay visible while the first chunk buffers (torrent metadata, peer
  // discovery, etc), Stremio-style.
  const [videoReady, setVideoReady] = useState(false);
  // True once playback has ACTUALLY started (first paused→playing). After that
  // a transient buffer underrun must NOT bring back the full-screen loading
  // overlay: mpv keeps playing without a paused→playing transition, so
  // `onPlaying` won't re-fire and `videoReady` would otherwise be stuck false,
  // leaving the overlay covering a playing video forever. (Diagnosed via the
  // file log: videoReady went true once, an onWaiting flipped it false, and it
  // never recovered.) Reset per stream.
  const everPlayedRef = useRef(false);
  // Mid-playback rebuffering (distinct from the initial load): true when mpv
  // underruns AFTER playback has started — e.g. seeking past the buffered
  // region, which can take many seconds to fetch the target bytes. Drives a
  // light "Buffering…" spinner over the (frozen) frame instead of the full
  // loading overlay, so a slow seek doesn't look like a hang.
  const [rebuffering, setRebuffering] = useState(false);
  // Last progress position seen — used to clear `rebuffering` the moment
  // playback advances smoothly again (backstop in case onPlaying doesn't
  // re-fire because mpv resumed without a paused→playing transition).
  const lastProgressPosRef = useRef(0);
  // Latest progress payload — flushed (un-throttled) on unmount so leaving the
  // player (close, or navigating to another page) always persists the final
  // position. The throttle only writes every 5s on its leading edge, so
  // without this the last few seconds before you leave are lost.
  const lastProgressRef = useRef<WatchProgress | null>(null);
  // Elapsed seconds since this stream started loading — shown in the
  // overlay so the user can decide when to skip to the next source.
  const [loadingSecs, setLoadingSecs] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [pseudoFs, setPseudoFs] = useState(false);

  const [subs, setSubs] = useState<Subtitle[]>([]);
  const [activeSubId, setActiveSubId] = useState<string | null>(null);
  const [subBlobUrl, setSubBlobUrl] = useState<string | null>(null);
  // Custom subtitles loaded by the user from disk — merged into the picker
  // alongside the OpenSubtitles results so the user always has a way to
  // attach a track even when the addon has nothing for this release.
  const [customSubs, setCustomSubs] = useState<Subtitle[]>([]);
  const subFileInputRef = useRef<HTMLInputElement | null>(null);

  // Torrent download stats (only relevant for source === "torrent").
  const [stats, setStats] = useState<{
    downloaded: number;
    total: number;
    rate: number;
    peersLive: number;
    peersSeen: number;
    peersConnecting: number;
    state: string;
  } | null>(null);

  const fsActive = isFullscreen || pseudoFs;
  const isTorrent = stream.source === "torrent";

  // Debug log panel — bug icon in the title bar toggles it. Subscribes to
  // the logger so entries stream in live while the panel is open. Two
  // actions: Copy (clipboard) + Clear.
  const [debugOpen, setDebugOpen] = useState(false);
  const [logTick, setLogTick] = useState(0);
  useEffect(() => {
    if (!debugOpen) return;
    return logger.subscribe(() => setLogTick((n) => n + 1));
  }, [debugOpen]);
  const logEntries: LogEntry[] = logTick >= 0 ? logger.getAll() : [];
  const copyLogs = async () => {
    try {
      await navigator.clipboard.writeText(exportAll());
      toast("ok", "Logs copied");
    } catch {
      toast("err", "Couldn't copy logs");
    }
  };

  // Cap how many auto-fallbacks fire in a row without ever reaching
  // `canplay`. Without this, a bad title with all-dead sources can cycle
  // through dozens of `torrent_start`/`stop_torrent` Rust calls back to
  // back, faster than librqbit can unwind, which has crashed the engine
  // (SIGABRT in a tokio worker). After 5 consecutive failures we stop
  // auto-skipping and let the user pick manually.
  const autoFallbackCountRef = useRef(0);
  const autoFallbackTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (videoReady) autoFallbackCountRef.current = 0;
  }, [videoReady]);
  useEffect(() => {
    return () => {
      if (autoFallbackTimerRef.current != null) {
        window.clearTimeout(autoFallbackTimerRef.current);
      }
    };
  }, []);

  // Coalesce + throttle auto-fallback to next source. Each call waits 800ms
  // and bails out if we've already advanced 5 times without a successful
  // playback. Gives librqbit a moment to fully delete the previous torrent
  // before we ask it to add a new one.
  const safeTryNext = useCallback((): boolean => {
    if (!onTryNextStream) return false;
    if (autoFallbackCountRef.current >= 5) {
      logger.warn("movies/player", "auto-fallback cap reached", {
        count: autoFallbackCountRef.current,
      });
      return false;
    }
    if (autoFallbackTimerRef.current != null) {
      logger.debug("movies/player", "auto-fallback already queued");
      return true;
    }
    logger.info("movies/player", "auto-fallback scheduled", {
      count: autoFallbackCountRef.current,
    });
    autoFallbackTimerRef.current = window.setTimeout(() => {
      autoFallbackTimerRef.current = null;
      autoFallbackCountRef.current += 1;
      const advanced = onTryNextStream();
      logger.info("movies/player", "auto-fallback fired", {
        advanced,
        count: autoFallbackCountRef.current,
      });
      if (!advanced) {
        setError(
          "All sources tried — pick another stream from the list once it loads.",
        );
      }
    }, 800);
    return true;
  }, [onTryNextStream]);

  // Reset the loading clock on every stream change.
  useEffect(() => {
    setLoadingSecs(0);
    if (videoReady) return;
    const t0 = Date.now();
    const id = window.setInterval(() => {
      setLoadingSecs(Math.floor((Date.now() - t0) / 1000));
    }, 1000);
    return () => window.clearInterval(id);
  }, [stream, videoReady]);

  // 1) Resolve the playable URL for this stream. For RD streams this is just
  // `stream.raw.url`; for torrent streams it boots up librqbit and returns a
  // local torrent-stream:// URL.
  useEffect(() => {
    let cancelled = false;
    logger.info("movies/player", "stream change", {
      source: stream.source,
      quality: stream.quality,
      seeders: stream.seeders,
      sizeLabel: stream.sizeLabel,
      infoHash: stream.raw.infoHash ?? null,
      fileIdx: stream.raw.fileIdx ?? null,
      provider: stream.provider,
      container: stream.container,
      webkitCompatible: stream.webkitCompatible,
      filename: stream.filename,
      streamIndex,
      streamCount,
    });
    setLoading(true);
    setError(null);
    setStreamUrl(null);
    setVideoReady(false);
    setRebuffering(false);
    everPlayedRef.current = false;
    lastProgressPosRef.current = 0;
    (async () => {
      try {
        const url = await resolveStreamUrl(stream);
        if (cancelled) return;
        setStreamUrl(url);
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        // Torrent_start failures (bad path, file already open, magnet
        // metadata refused, etc.) are deterministic — they'll keep
        // failing if we sit on them. Auto-advance to the next source,
        // but throttled so the Rust engine doesn't get hammered.
        const queued = safeTryNext();
        if (!queued) setError(msg);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      // Detach the src BEFORE stopping the torrent — otherwise the still-
      // mounted <video> keeps issuing Range requests against a torrent we
      // just removed from the engine, spamming the console with 404s.
      // (Native path only; on mpv the next load replaces the source.)
      const v = getVideoEl();
      if (v) {
        try {
          v.pause();
          v.removeAttribute("src");
          v.load();
        } catch {
          /* ignore */
        }
      }
      if (stream.source === "torrent" && stream.raw.infoHash) {
        stopTorrent(stream.raw.infoHash);
      }
    };
  }, [stream]);

  // 2) Fetch + parse subtitles for this title.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const list = await fetchSubtitles(progressType, subtitleSearchId);
      if (!cancelled) setSubs(list);
    })();
    return () => {
      cancelled = true;
    };
  }, [progressType, subtitleSearchId]);

  // 2b) User-loaded subtitle file. We read it, normalise SRT → VTT, hand
  // the resulting blob URL straight to the player. The custom track shows
  // up in the picker as a top-of-list option labeled with the filename.
  const handleSubFile = useCallback(async (file: File) => {
    try {
      const text = await file.text();
      const isVtt = /^\s*WEBVTT/i.test(text) || file.name.toLowerCase().endsWith(".vtt");
      const vtt = isVtt ? text : srtToVtt(text);
      const blobUrl = URL.createObjectURL(
        new Blob([vtt], { type: "text/vtt" }),
      );
      const id = `custom-${Date.now()}`;
      const entry: Subtitle = {
        id,
        url: blobUrl,
        lang: "und",
        label: file.name.replace(/\.(srt|vtt)$/i, ""),
      };
      // libmpv can't read blob: URLs — persist the normalised VTT to a temp
      // file so the mpv path can sub-add it by path. Best-effort; the native
      // <track> path uses the blob URL regardless.
      try {
        const dir = await appCacheDir();
        const path = await join(dir, `mosaic-sub-${id}.vtt`);
        await invoke("write_text_file", { path, contents: vtt });
        setCustomMpvPaths((m) => ({ ...m, [id]: path }));
      } catch {
        /* mpv path just won't have this custom track */
      }
      setCustomSubs((prev) => [entry, ...prev]);
      setActiveSubId(id);
    } catch {
      toast("err", "Couldn't load subtitle file");
    }
  }, []);

  // Combined picker list — custom tracks first so the user can find them.
  const allSubs = useMemo(() => [...customSubs, ...subs], [customSubs, subs]);

  // Subtitles libmpv can actually fetch: OpenSubtitles http(s) URLs as-is,
  // custom uploads via their on-disk temp path. blob: URLs (custom uploads
  // before the temp write lands) are dropped — mpv can't read them.
  const mpvSubs: VideoStageSubtitle[] = useMemo(
    () =>
      allSubs
        .map((s) => ({
          id: s.id,
          lang: s.lang,
          label: s.label ?? langLabel(s.lang),
          url: s.id.startsWith("custom-")
            ? customMpvPaths[s.id] ?? s.url
            : s.url,
        }))
        .filter((s) => !s.url.startsWith("blob:")),
    [allSubs, customMpvPaths],
  );

  // URL we actually hand the player. On the mpv path, torrent scheme URLs are
  // rewritten to the local HTTP bridge (and we wait for its base to arrive);
  // Real-Debrid http URLs and the native <video> path pass through unchanged.
  const playUrl = useMemo(() => {
    if (!streamUrl) return null;
    if (mpvSupported && streamUrl.startsWith("torrent-stream://")) {
      return httpBase ? toMpvStreamUrl(streamUrl, httpBase) : null;
    }
    return streamUrl;
  }, [streamUrl, mpvSupported, httpBase]);

  // Saved entry for this title — drives the resume position AND the remembered
  // track selections (audio language + subtitle). Re-read when the source
  // changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const savedEntry = useMemo(() => store.getProgress(progressKey), [progressKey, streamUrl]);
  const resumePosition = savedEntry?.position;

  // Remembered track prefs, persisted alongside progress and seeded from the
  // saved entry. Updated as the user switches audio / subtitle below.
  const trackPrefsRef = useRef<
    Pick<WatchProgress, "audioLang" | "audioTitle" | "subKind" | "subLang" | "subId">
  >({ audioLang: null, audioTitle: null, subKind: null, subLang: null, subId: null });
  useEffect(() => {
    trackPrefsRef.current = {
      audioLang: savedEntry?.audioLang ?? null,
      audioTitle: savedEntry?.audioTitle ?? null,
      subKind: savedEntry?.subKind ?? null,
      subLang: savedEntry?.subLang ?? null,
      subId: savedEntry?.subId ?? null,
    };
  }, [savedEntry]);

  // Throttled progress persistence, driven by VideoStage's onProgress.
  const saveProgressRef = useRef(store.throttledSaver(5000));
  const handleProgress = useCallback(
    (pos: number, dur: number) => {
      if (!dur || !Number.isFinite(dur)) return;
      // Backstop for the rebuffering spinner: clear it the instant playback
      // advances *smoothly* (a small positive step). A large jump is a seek
      // (position teleports to the target before data arrives), so we ignore
      // those — only continuous progress means we're really playing again.
      const last = lastProgressPosRef.current;
      const delta = pos - last;
      if (delta > 0 && delta < 2) setRebuffering(false);
      lastProgressPosRef.current = pos;
      const payload: WatchProgress = {
        id: progressKey,
        type: progressType,
        position: pos,
        duration: dur,
        watchedAt: Date.now(),
        name: title,
        poster: persistPoster ?? null,
        seriesId: persistSeriesId,
        episodeLabel: persistEpisodeLabel,
        ...trackPrefsRef.current,
      };
      lastProgressRef.current = payload;
      saveProgressRef.current(payload);
    },
    [progressKey, progressType, title, persistPoster, persistSeriesId, persistEpisodeLabel],
  );

  // Final flush on unmount — see lastProgressRef. saveProgress itself drops
  // near-complete watches (within 60s of the end), so this won't resurrect a
  // finished title as "continue watching".
  useEffect(() => {
    return () => {
      if (lastProgressRef.current) store.saveProgress(lastProgressRef.current);
    };
  }, []);

  // --- Audio-track memory (mpv path) -------------------------------------
  // The mpv track-list is the only place the selected audio id surfaces, so we
  // restore by LANGUAGE (ids aren't stable across torrent sources) and record
  // the user's choice as they switch in the player bar. onTracks only fires on
  // change (never replays the previous file), so the first emission after a
  // load is reliably this stream's.
  const appliedAudioRef = useRef(false);
  const lastAudioLangRef = useRef<string | null>(null);
  useEffect(() => {
    appliedAudioRef.current = false;
    lastAudioLangRef.current = null;
  }, [playUrl]);
  useEffect(() => {
    if (!mpvSupported) return;
    return mpv.onTracks((j) => {
      let tracks: Array<{
        id?: number;
        type?: string;
        lang?: string;
        title?: string;
        selected?: boolean;
      }> = [];
      try {
        tracks = JSON.parse(j);
      } catch {
        return;
      }
      const audio = Array.isArray(tracks)
        ? tracks.filter((t) => t.type === "audio")
        : [];
      if (audio.length === 0) return;
      // Restore the remembered language once per stream.
      if (!appliedAudioRef.current) {
        appliedAudioRef.current = true;
        const want = trackPrefsRef.current.audioLang;
        if (want) {
          const match = audio.find(
            (t) => (t.lang ?? "").toLowerCase() === want.toLowerCase(),
          );
          if (match && !match.selected && match.id != null) {
            void mpv.setProperty("aid", String(match.id)).catch(() => {});
            return; // the resulting selection change re-fires onTracks
          }
        }
      }
      // Record the current selection.
      const sel = audio.find((t) => t.selected);
      const lang = sel?.lang ?? null;
      if (lang !== lastAudioLangRef.current) {
        lastAudioLangRef.current = lang;
        trackPrefsRef.current = {
          ...trackPrefsRef.current,
          audioLang: lang,
          audioTitle: sel?.title ?? null,
        };
        store.updateTrackPrefs(progressKey, {
          audioLang: lang,
          audioTitle: sel?.title ?? null,
        });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mpvSupported, progressKey]);

  // --- Subtitle memory (external OpenSubtitles + custom uploads) ----------
  // Restore the remembered subtitle language once the list is fetched, and
  // record the user's pick (or explicit "off") thereafter. Matched by language
  // since external sub ids change between sessions. Embedded sub tracks aren't
  // remembered yet (they're indistinguishable from added externals in mpv's
  // track-list).
  const restoredSubRef = useRef(false);
  const prevSubIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    restoredSubRef.current = false;
    prevSubIdRef.current = undefined;
  }, [progressKey]);
  useEffect(() => {
    if (restoredSubRef.current) return;
    const want = trackPrefsRef.current;
    if (want.subKind !== "external" || !want.subLang) return;
    if (activeSubId) {
      restoredSubRef.current = true;
      return;
    }
    if (allSubs.length === 0) return; // wait for the fetch
    const match = allSubs.find(
      (s) => (s.lang ?? "").toLowerCase() === want.subLang!.toLowerCase(),
    );
    if (match) setActiveSubId(match.id);
    restoredSubRef.current = true;
  }, [allSubs, activeSubId]);
  useEffect(() => {
    const prev = prevSubIdRef.current;
    prevSubIdRef.current = activeSubId;
    if (prev === undefined) return; // initial value, not a user action
    if (activeSubId) {
      const sub = allSubs.find((s) => s.id === activeSubId);
      const lang = sub?.lang ?? null;
      trackPrefsRef.current = {
        ...trackPrefsRef.current,
        subKind: "external",
        subLang: lang,
        subId: activeSubId,
      };
      store.updateTrackPrefs(progressKey, {
        subKind: "external",
        subLang: lang,
        subId: activeSubId,
      });
    } else if (prev) {
      trackPrefsRef.current = {
        ...trackPrefsRef.current,
        subKind: "off",
        subLang: null,
        subId: null,
      };
      store.updateTrackPrefs(progressKey, { subKind: "off", subLang: null, subId: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSubId, allSubs]);

  // 3) When the active sub changes, fetch the SRT, convert to VTT, hand a
  // blob: URL to <track>. Revoke the previous blob to avoid a leak.
  useEffect(() => {
    let cancelled = false;
    let priorBlob: string | null = null;
    setSubBlobUrl((prev) => {
      priorBlob = prev;
      return null;
    });
    if (!activeSubId) {
      if (priorBlob) URL.revokeObjectURL(priorBlob);
      return;
    }
    const target = allSubs.find((s) => s.id === activeSubId);
    if (!target) return;
    // Custom (user-uploaded) tracks already point at a blob: URL we built
    // from a normalised VTT string — skip the fetch+convert step.
    if (target.id.startsWith("custom-")) {
      setSubBlobUrl(target.url);
      return;
    }
    (async () => {
      try {
        const blob = await loadSubtitleAsVttBlob(target.url);
        if (cancelled) {
          URL.revokeObjectURL(blob);
          return;
        }
        setSubBlobUrl(blob);
        // Activate the <track> on the next tick (native path only — the mpv
        // path has no <video>/textTracks; it loads subs via sub-add).
        requestAnimationFrame(() => {
          const v = getVideoEl();
          if (!v) return;
          for (const tt of Array.from(v.textTracks)) {
            tt.mode = tt.label === target.label || tt.language === target.lang
              ? "showing"
              : "disabled";
          }
        });
      } catch {
        toast("err", "Couldn't load subtitle track");
      }
    })();
    return () => {
      cancelled = true;
      if (priorBlob) URL.revokeObjectURL(priorBlob);
    };
  }, [activeSubId, allSubs]);

  // 4) Resume + progress persistence are handled by VideoStage via the
  // `resumePosition` prop and the `onProgress` callback (see handleProgress).

  // 5) Poll torrent stats while playing torrent-backed streams. Reset
  // stats to null on stream change so the previous source's downloaded
  // bytes don't leak into the next source's "Starting torrent engine…"
  // panel (otherwise the user sees an inconsistent "37 MB / 1.54 GB"
  // count for a torrent that hasn't even been added yet).
  useEffect(() => {
    setStats(null);
    if (!isTorrent || !stream.raw.infoHash) {
      return;
    }
    let cancelled = false;
    let lastLoggedRate = -1;
    let lastLoggedPeers = -1;
    const tick = async () => {
      try {
        const s = await torrentStatus(stream.raw.infoHash!);
        if (cancelled) return;
        if (s.active) {
          setStats({
            downloaded: s.downloaded_bytes,
            total: s.total_bytes,
            rate: s.download_rate_bps,
            peersLive: s.peers_live,
            peersSeen: s.peers_seen,
            peersConnecting: s.peers_connecting,
            state: s.state,
          });
          // Log only when peer count or rate changes by ≥30% to avoid
          // spamming the buffer with near-identical entries every 2s.
          const rateChanged =
            lastLoggedRate < 0 ||
            Math.abs(s.download_rate_bps - lastLoggedRate) >
              Math.max(50_000, lastLoggedRate * 0.3);
          const peersChanged = s.peers_live !== lastLoggedPeers;
          if (rateChanged || peersChanged) {
            logger.debug("movies/torrent", "stats", {
              state: s.state,
              downloaded: s.downloaded_bytes,
              total: s.total_bytes,
              rateKBs: Math.round(s.download_rate_bps / 1024),
              peersLive: s.peers_live,
              peersSeen: s.peers_seen,
              peersConnecting: s.peers_connecting,
            });
            lastLoggedRate = s.download_rate_bps;
            lastLoggedPeers = s.peers_live;
          }
        }
      } catch (e) {
        logger.warn("movies/torrent", "torrent_status failed (ignored)", {
          err: e instanceof Error ? e.message : String(e),
        });
      }
    };
    tick();
    const id = window.setInterval(tick, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [isTorrent, stream.raw.infoHash]);

  // Fullscreen plumbing (same as TVPlayer)
  useEffect(() => {
    const handler = () => setIsFullscreen(!!getFullscreenElement());
    document.addEventListener("fullscreenchange", handler);
    document.addEventListener("webkitfullscreenchange", handler);
    return () => {
      document.removeEventListener("fullscreenchange", handler);
      document.removeEventListener("webkitfullscreenchange", handler);
    };
  }, []);

  useEffect(() => {
    if (!pseudoFs) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPseudoFs(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [pseudoFs]);

  const toggleFullscreen = async () => {
    // mpv owns real fullscreen (drives the Tauri window).
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
    const v = getVideoEl() as WebkitVideo | null;
    if (!v) return;
    if (v.webkitEnterFullscreen) {
      try {
        v.webkitEnterFullscreen();
        return;
      } catch {
        /* fall through */
      }
    }
    if (v.requestFullscreen) {
      try {
        await v.requestFullscreen();
        return;
      } catch {
        /* fall through */
      }
    }
    if (v.webkitRequestFullscreen) {
      try {
        await v.webkitRequestFullscreen();
        return;
      } catch {
        /* fall through */
      }
    }
    setPseudoFs(true);
  };

  const togglePip = async () => {
    const v = getVideoEl();
    if (!v) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if ("requestPictureInPicture" in v) {
        await v.requestPictureInPicture();
      }
    } catch {
      /* ignore */
    }
  };

  return (
    <div
      className={clsx(
        "w-full h-full flex flex-col",
        // mpv renders below the transparent webview, so the player must not
        // paint an opaque background behind the video region NOR get promoted
        // to a compositing layer (overflow-hidden can make WebKit render the
        // backing store opaque over the native view). Native path keeps both.
        mpvSupported ? "" : "overflow-hidden bg-black",
      )}
    >
      {/* Title strip. `relative z-[10000]` keeps it (and its buttons) clickable
          in fullscreen: the plugin promotes the mpv surface
          (`data-player-fullscreen-keep`) to `fixed inset-0 z-[9999]`, which
          otherwise covers this bar and swallows clicks (they hit mpv's
          play/pause handler). Sitting at 10000 puts the title bar back on top. */}
      <div className="relative z-[10000] flex items-center gap-3 px-3.5 md:px-4 py-2.5 border-b border-white/5 bg-black/90 backdrop-blur-md shrink-0">
        <div className="min-w-0 flex-1">
          <h2 className="text-[14.5px] font-semibold text-white truncate">
            {title}
          </h2>
          {subtitle && (
            <div className="text-[11px] text-neutral-400 truncate mt-0.5">
              {subtitle}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => setDebugOpen((v) => !v)}
            aria-pressed={debugOpen}
            className={clsx(
              "p-1.5 rounded-md transition-colors",
              debugOpen
                ? "bg-violet-500/20 text-violet-100"
                : "text-neutral-400 hover:text-white hover:bg-white/10",
            )}
            title="Debug log (share with developer if playback is broken)"
            aria-label="Debug log"
          >
            <Bug size={15} />
          </button>
          {onToggleFavorite && (
            <button
              type="button"
              onClick={onToggleFavorite}
              aria-pressed={isFavorite}
              className={clsx(
                "p-1.5 rounded-md transition-colors",
                isFavorite
                  ? "text-rose-400 hover:text-rose-300 hover:bg-rose-500/10"
                  : "text-neutral-400 hover:text-rose-300 hover:bg-white/10",
              )}
              title={isFavorite ? "Remove from favorites" : "Add to favorites"}
            >
              <Heart
                size={15}
                strokeWidth={2}
                fill={isFavorite ? "currentColor" : "none"}
              />
            </button>
          )}
          {/* Browser PiP only exists on the native <video> path; mpv
              (vo=libmpv) has no PiP. */}
          {!mpvSupported && (
            <button
              type="button"
              onClick={togglePip}
              className="p-1.5 rounded-md text-neutral-400 hover:text-white hover:bg-white/10"
              title="Picture in picture"
              aria-label="Picture in picture"
            >
              <PictureInPicture2 size={15} />
            </button>
          )}
          <button
            type="button"
            onClick={toggleFullscreen}
            className="p-1.5 rounded-md text-neutral-400 hover:text-white hover:bg-white/10"
            title="Fullscreen"
            aria-label={fsActive ? "Exit fullscreen" : "Fullscreen"}
          >
            {fsActive ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md text-neutral-400 hover:text-white hover:bg-white/10"
            title="Close player"
            aria-label="Close player"
          >
            <X size={15} />
          </button>
        </div>
      </div>

      {/* Stage — stretches to fill the remaining vertical space inside the
          fullscreen wrapper so the video itself sits on a true black canvas
          instead of an aspect-ratio-constrained box. */}
      <div
        ref={wrapRef}
        className={clsx(
          "relative flex-1 min-h-0",
          // Transparent on the mpv path so the native video layer shows
          // through; black canvas on the native <video> path.
          mpvSupported ? "" : "bg-black",
          pseudoFs && "fixed inset-0 z-[9999] w-screen h-screen",
        )}
      >
        {playUrl && (
          <VideoStage
            ref={stageRef}
            src={playUrl}
            autoplay
            resumePosition={resumePosition}
            crossOrigin="anonymous"
            subtitles={mpvSubs}
            activeSubId={activeSubId}
            className="absolute inset-0"
            onReady={() => {
              logger.info("movies/player", "player ready");
              setVideoReady(true);
            }}
            onWaiting={() => {
              logger.debug("movies/player", "player waiting (rebuffer)");
              if (everPlayedRef.current) {
                // Playback already started → this is mid-stream rebuffering
                // (e.g. a seek past the buffer). Keep the frame, show the light
                // "Buffering…" spinner rather than the full loading overlay.
                setRebuffering(true);
              } else {
                // Still in the initial load → full overlay stays up.
                setVideoReady(false);
              }
            }}
            onPlaying={() => {
              logger.info("movies/player", "player playing");
              everPlayedRef.current = true;
              setVideoReady(true);
              setRebuffering(false);
            }}
            onProgress={handleProgress}
            onError={(info) => {
              // Only auto-fallback for fast, deterministic failures (native
              // code 4 = MEDIA_ERR_SRC_NOT_SUPPORTED: the container/codec
              // can't even be opened). For network/decode errors we hold the
              // current source — a slow torrent fires these mid-buffer and
              // bouncing would restart a 30-60s metadata fetch. (mpv decodes
              // most containers, so it rarely reports code 4 at all.)
              const code = info.code;
              logger.error("movies/player", "player error", {
                code,
                msg: info.message,
                container: stream.container,
                webkitCompatible: stream.webkitCompatible,
              });
              if (code === 4 && safeTryNext()) return;
              const isContainerProblem = code === 4 && !stream.webkitCompatible;
              setError(
                isContainerProblem
                  ? `Built-in player can't decode ${stream.container.toUpperCase()} — pick an MP4 source from the list (or hook up Real-Debrid in Settings, which remuxes any container to MP4).`
                  : "Playback failed — the source may be unavailable. Pick another stream from the list.",
              );
            }}
          >
            {subBlobUrl && activeSubId && (
              <track
                kind="subtitles"
                src={subBlobUrl}
                srcLang={allSubs.find((s) => s.id === activeSubId)?.lang}
                label={langLabel(
                  allSubs.find((s) => s.id === activeSubId)?.lang ?? "eng",
                )}
                default
              />
            )}
          </VideoStage>
        )}

        {/* Loading / buffering overlay — Stremio-style. Stays mounted on top
            of the <video> until the element fires `canplay`. For torrents we
            also surface live downloaded / peers / rate so the user knows it's
            actually doing something while waiting on metadata + peers. */}
        {(!streamUrl || !videoReady) && !error && (
          <div
            className="absolute inset-0 grid place-items-center"
            style={{
              // SOLID opaque background — NO backdrop-blur. On the mpv path this
              // overlay sits over the native NSView through the transparent
              // webview; `backdrop-filter: blur()` there made WebKit render the
              // region as an opaque black backing store that ate the spinner
              // (the "black screen, no loader" on start). A plain solid fill
              // composites the loader reliably.
              background:
                "radial-gradient(120% 120% at 50% 35%, #1a1a1f 0%, #0b0b0d 70%)",
            }}
          >
            <div className="flex flex-col items-center gap-4 px-6 text-center max-w-md">
              <Loader2 size={36} className="animate-spin text-violet-300" />
              <div>
                <div className="text-[15px] font-medium text-white">
                  {isTorrent
                    ? !streamUrl
                      ? "Loading magnet…"
                      : stats && stats.downloaded > 0
                        ? "Buffering first chunk…"
                        : "Finding peers…"
                    : !streamUrl
                      ? "Loading stream…"
                      : "Buffering…"}
                </div>
                <div className="text-[12px] text-neutral-400 mt-1">
                  {isTorrent
                    ? !streamUrl
                      ? "Fetching torrent metadata from the swarm — this can take a few seconds on first play."
                      : "Playback starts as soon as enough has downloaded."
                    : "This usually takes a couple of seconds."}
                </div>
                <div className="text-[10.5px] text-neutral-500 mt-2">
                  {typeof streamCount === "number" &&
                  typeof streamIndex === "number" &&
                  streamCount > 1
                    ? `Source ${streamIndex + 1} of ${streamCount} · ${loadingSecs}s elapsed`
                    : `${loadingSecs}s elapsed`}
                </div>
              </div>

              {/* Progress: a determinate bar once we have download stats with a
                  known total; otherwise an always-moving indeterminate bar so
                  the wait (torrent metadata / peer discovery) never looks
                  frozen. */}
              {!(isTorrent && stats && stats.total > 0 && stats.downloaded > 0) && (
                <div className="w-full max-w-xs h-1.5 rounded-full bg-white/10 overflow-hidden">
                  <div className="h-full w-1/3 rounded-full bg-violet-400 animate-[indeterminate-slide_1.3s_ease-in-out_infinite]" />
                </div>
              )}

              {isTorrent && stats && (
                <div className="w-full max-w-xs space-y-2">
                  {stats.total > 0 && stats.downloaded > 0 && (
                    <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                      <div
                        className="h-full bg-violet-400 transition-[width]"
                        style={{
                          width: `${Math.min(100, (stats.downloaded / stats.total) * 100).toFixed(2)}%`,
                        }}
                      />
                    </div>
                  )}
                  <div className="flex items-center justify-between text-[11px] text-neutral-400">
                    <span className="inline-flex items-center gap-1.5">
                      <Download size={11} />
                      {fmtBytes(stats.downloaded)}
                      {stats.total > 0 && ` / ${fmtBytes(stats.total)}`}
                    </span>
                    <span>{fmtBytes(stats.rate)}/s</span>
                  </div>
                  {/* Peer counts — surfaced during buffering so the user
                      can tell whether the torrent has actually found peers
                      or is still bootstrapping. "Live" = currently
                      transferring, "Seen" = total ever announced by the
                      swarm (DHT + trackers). */}
                  <div className="flex items-center justify-between text-[11px] text-neutral-400">
                    <span className="inline-flex items-center gap-1.5">
                      <Users size={11} />
                      <span className="text-emerald-300 font-medium">
                        {stats.peersLive}
                      </span>
                      <span className="text-neutral-500">live</span>
                      <span className="text-neutral-600">·</span>
                      <span>{stats.peersSeen} seen</span>
                      {stats.peersConnecting > 0 && (
                        <>
                          <span className="text-neutral-600">·</span>
                          <span>{stats.peersConnecting} connecting</span>
                        </>
                      )}
                    </span>
                    {stats.state && (
                      <span
                        className="text-[10px] uppercase tracking-wider text-neutral-500"
                        title={`librqbit state: ${stats.state}`}
                      >
                        {stats.state}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Surface the manual "Try next source" button once it's clear
                  the user has been waiting for a while. Auto-fallback is
                  reserved for hard "unsupported source" errors only — for
                  slow torrents we let the user decide so we don't cascade
                  through every source's cold-start metadata fetch. */}
              {loadingSecs >= 15 &&
                onTryNextStream &&
                typeof streamCount === "number" &&
                typeof streamIndex === "number" &&
                streamIndex + 1 < streamCount && (
                  <button
                    type="button"
                    onClick={() => onTryNextStream()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white/10 border border-white/15 text-white text-[12px] hover:bg-white/20"
                  >
                    Try next source
                  </button>
                )}
            </div>
          </div>
        )}

        {/* Mid-playback buffering indicator — shown when a seek (or a stall)
            lands past the buffered region and mpv needs to fetch the target,
            which can take several seconds on a torrent. Light-weight: a small
            centered pill over the frozen frame, NOT the full loading overlay,
            so it reads as "buffering" rather than "starting over". */}
        {rebuffering && videoReady && !error && (
          <div className="absolute inset-0 grid place-items-center pointer-events-none">
            <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-full bg-black/75 border border-white/10 shadow-xl shadow-black/50">
              <Loader2 size={18} className="animate-spin text-violet-300" />
              <span className="text-[13px] font-medium text-white">
                {isTorrent ? "Buffering — fetching this part…" : "Buffering…"}
              </span>
            </div>
          </div>
        )}

        {/* Hard-error overlay — separate from the loading overlay so we can
            keep showing the underlying video frame on transient hiccups. */}
        {error && (
          <div className="absolute inset-0 grid place-items-center bg-black/90 px-6">
            <div className="text-center max-w-sm flex flex-col items-center gap-3">
              <AlertTriangle
                size={28}
                className="text-rose-300"
              />
              <div className="text-[13.5px] text-rose-200">{error}</div>
              {onTryNextStream &&
                typeof streamCount === "number" &&
                typeof streamIndex === "number" &&
                streamIndex + 1 < streamCount && (
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      onTryNextStream();
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white/10 border border-white/15 text-white text-[12px] hover:bg-white/20"
                  >
                    Try next source ({streamIndex + 2}/{streamCount})
                  </button>
                )}
            </div>
          </div>
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

        {/* Debug log panel — overlays the stage. Anchored top-right so it
            doesn't fight with the close/fullscreen controls. z-[10000] keeps it
            interactive in fullscreen, where the plugin promotes the mpv surface
            to z-[9999] (same reason the title bar needs it). */}
        {debugOpen && (
          <div className="absolute top-3 right-3 bottom-3 w-[min(640px,calc(100%-24px))] z-[10000] flex flex-col rounded-xl border border-white/10 bg-black/95 backdrop-blur-sm shadow-2xl shadow-black/60">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10">
              <Bug size={13} className="text-violet-300" />
              <span className="text-[12px] font-medium text-white">
                Debug log
              </span>
              <span className="text-[10.5px] text-neutral-500">
                {logEntries.length} entries
              </span>
              <div className="flex-1" />
              <button
                type="button"
                onClick={copyLogs}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] bg-white/5 border border-white/10 text-neutral-200 hover:bg-white/10 hover:text-white"
                title="Copy all entries to clipboard"
              >
                <Copy size={11} />
                Copy
              </button>
              <button
                type="button"
                onClick={() => {
                  logger.clear();
                  setLogTick((n) => n + 1);
                }}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] bg-white/5 border border-white/10 text-neutral-400 hover:bg-white/10 hover:text-white"
                title="Clear log buffer"
              >
                <Trash2 size={11} />
                Clear
              </button>
              <button
                type="button"
                onClick={() => setDebugOpen(false)}
                className="p-1 rounded-md text-neutral-400 hover:text-white hover:bg-white/10"
                aria-label="Close debug panel"
                title="Close"
              >
                <X size={12} />
              </button>
            </div>
            <div
              className="flex-1 overflow-y-auto font-mono text-[10.5px] leading-[1.45] px-2 py-1.5 selection:bg-violet-500/40"
              // Re-enable text selection inside the panel so the user can
              // also drag-select a snippet if they prefer that over Copy.
              style={{ userSelect: "text", WebkitUserSelect: "text" }}
            >
              {logEntries.length === 0 ? (
                <div className="text-neutral-500 text-center py-6">
                  No log entries yet.
                </div>
              ) : (
                logEntries.map((e, i) => (
                  <div
                    key={i}
                    className={clsx(
                      "whitespace-pre-wrap break-all py-0.5 px-1 rounded",
                      e.level === "error" && "text-rose-300 bg-rose-500/5",
                      e.level === "warn" && "text-amber-200",
                      e.level === "info" && "text-neutral-200",
                      e.level === "debug" && "text-neutral-500",
                    )}
                  >
                    {formatEntry(e)}
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* Footer — native <video> path only. On the mpv path the controls bar
          (with its own Subtitles menu) supersedes it; torrent stats live in
          the loading overlay and errors in the error overlay, so this bottom
          strip is just clutter there. */}
      {!mpvSupported && (
      <div className="px-3 md:px-4 py-2.5 border-t border-white/5 bg-black/90 backdrop-blur-md flex flex-wrap items-center gap-2 shrink-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wider text-neutral-500">
            Subs
          </span>
          <select
            value={activeSubId ?? ""}
            onChange={(e) => setActiveSubId(e.target.value || null)}
            disabled={allSubs.length === 0}
            className="bg-white/5 border border-white/10 rounded-md px-2 py-0.5 text-[11.5px] focus:outline-none focus:ring-1 focus:ring-violet-400/40 max-w-[180px] disabled:opacity-60"
          >
            <option value="">
              {allSubs.length === 0 ? "None found" : "Off"}
            </option>
            {customSubs.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label ?? "Custom"}
              </option>
            ))}
            {subs.map((s) => (
              <option key={s.id} value={s.id}>
                {langLabel(s.lang)}
              </option>
            ))}
          </select>
          <input
            ref={subFileInputRef}
            type="file"
            accept=".srt,.vtt,text/vtt,application/x-subrip"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleSubFile(f);
              // Reset so picking the same file twice still fires onChange.
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => subFileInputRef.current?.click()}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-white/5 border border-white/10 text-neutral-300 hover:bg-white/10 hover:text-white text-[11px]"
            title="Upload .srt or .vtt subtitle file"
          >
            <Upload size={11} />
            Upload
          </button>
        </div>

        {isTorrent && stats && (
          <div
            className="inline-flex items-center gap-2 text-[10.5px] text-amber-200/90"
            title="Local torrent download — peers exchanging chunks with us right now."
          >
            <span className="inline-flex items-center gap-1">
              <Download size={11} />
              {fmtBytes(stats.downloaded)} / {fmtBytes(stats.total)} ·{" "}
              {fmtBytes(stats.rate)}/s
            </span>
            <span className="inline-flex items-center gap-1 text-neutral-400">
              <Users size={11} />
              {stats.peersLive}/{stats.peersSeen}
            </span>
          </div>
        )}

        <div className="flex-1" />

        {error && (
          <div className="inline-flex items-center gap-1.5 text-[10.5px] text-rose-300/90 max-w-[320px] truncate" title={error}>
            <AlertTriangle size={12} />
            <span className="truncate">{error}</span>
          </div>
        )}
      </div>
      )}
    </div>
  );
}
