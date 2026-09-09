"use client";
import { useEffect, useRef, useState } from "react";
import type { WtSource, WtSyncPayload } from "@/lib/calls/types";
import type {
  WtSyncOutgoing,
  WtSnapshotProvider,
} from "@/lib/calls/useCall";

// Snap to a remote position only if we're more than this far off — avoids
// micro-corrections after a play/pause when the timestamps drift by ~50ms.
const SEEK_TOLERANCE_SEC = 0.5;
// While we're applying a remote event, the player's own play/pause/seeked
// listeners will fire in response — ignore them for this window to avoid
// echoing them back. 400ms covers YT's slow PLAYING transition.
const ECHO_SUPPRESS_MS = 400;
// Threshold for detecting seek jumps from YouTube's currentTime stream.
const YT_SEEK_JUMP_SEC = 0.75;
// YouTube's infoDelivery cadence — used as the expected delta between
// successive currentTime samples while playing.
const YT_INFO_DELIVERY_SEC = 0.25;

type Backend = {
  play: () => void;
  pause: () => void;
  seekTo: (sec: number) => void;
  getCurrent: () => number;
  isPaused: () => boolean;
  destroy: () => void;
};

type YTIncomingMessage = {
  event?: string;
  info?: { currentTime?: number; playerState?: number } | number;
  id?: string;
};

export default function WatchTogetherPlayer({
  source,
  sendSync,
  subscribeSync,
  setSnapshotProvider,
}: {
  source: WtSource;
  sendSync: (p: WtSyncOutgoing) => void;
  subscribeSync: (fn: (p: WtSyncPayload) => void) => () => void;
  setSnapshotProvider: (fn: WtSnapshotProvider | null) => void;
}) {
  // Backend handle — same shape for YouTube and HTML5 so the sync glue is
  // backend-agnostic.
  const backendRef = useRef<Backend | null>(null);
  const backendReadyRef = useRef(false);
  // Events that arrived before the backend was ready (e.g. YT iframe API
  // still loading when the host pasted the URL). Applied once on ready.
  const pendingRef = useRef<WtSyncPayload | null>(null);
  // performance.now() until which to ignore the player's local events
  // (because we just applied a remote one and the player will replay it).
  const applyingUntilRef = useRef(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  const applyRemote = (p: WtSyncPayload) => {
    const backend = backendRef.current;
    if (!backend) return;
    if (p.op === "stop") return;
    applyingUntilRef.current = performance.now() + ECHO_SUPPRESS_MS;
    if (typeof p.positionSec === "number") {
      const current = backend.getCurrent();
      if (Math.abs(current - p.positionSec) > SEEK_TOLERANCE_SEC) {
        backend.seekTo(p.positionSec);
      }
    }
    if (p.op === "play") backend.play();
    else if (p.op === "pause") backend.pause();
    else if (p.op === "state") {
      if (p.playing === true) backend.play();
      else if (p.playing === false) backend.pause();
    }
  };

  const sourceKey =
    source.kind === "youtube"
      ? `yt:${source.videoId}`
      : `url:${source.url}`;

  // Construct the backend whenever the source changes. Cleanup destroys
  // the previous one before creating the new — critical for YT.Player
  // which leaks iframes and tons of bound listeners otherwise.
  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    const isYouTube = source.kind === "youtube";

    const broadcast = (p: WtSyncOutgoing) => {
      if (performance.now() < applyingUntilRef.current) return;
      sendSync(p);
    };

    if (isYouTube) {
      // We deliberately avoid the official YT IFrame Player API
      // (`https://www.youtube.com/iframe_api`) because it forces the
      // iframe URL to include `origin=<parent>`. In Tauri, the parent is
      // `tauri://localhost`, which YouTube's embed rejects with "Error
      // 153 — Video player configuration error". Talking to the embed
      // directly via postMessage with no `origin` query param works.
      const host = document.getElementById("wt-player-host");
      if (!host) return;
      // Minimal params: enable JS API for sync messages, allow inline
      // playback on iOS-like WebKits. Skip rel/playlist/origin — those
      // sometimes trigger Error 153 ("Video player configuration error").
      // The Tauri webview's user-agent is set to a real Safari UA in
      // tauri.conf.json so YouTube's embed doesn't refuse on the basis
      // of an unknown WebView UA.
      const params = new URLSearchParams({
        enablejsapi: "1",
        playsinline: "1",
      });
      const iframeSrc = `https://www.youtube.com/embed/${encodeURIComponent(
        source.videoId,
      )}?${params.toString()}`;
      host.innerHTML = `<iframe src="${iframeSrc}" class="w-full h-full" frameborder="0" referrerpolicy="strict-origin-when-cross-origin" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>`;
      const iframe = host.querySelector("iframe");
      if (!iframe) return;

      let lastSampled = 0;
      let isPlaying = false;
      // Last play/pause state we broadcast — guards against firing
      // duplicate events when the same transition is reported by both
      // onStateChange and infoDelivery.
      let lastBroadcastPlaying: boolean | null = null;
      // Broadcast a play/pause op once per real transition, debounced
      // across the two YouTube event streams. Echo-suppression (during
      // applyingUntil) still applies via `broadcast`.
      const broadcastPlayState = (playing: boolean, positionSec: number) => {
        if (lastBroadcastPlaying === playing) return;
        lastBroadcastPlaying = playing;
        broadcast({ op: playing ? "play" : "pause", positionSec });
      };

      const sendCmd = (func: string, args: unknown[] = []) => {
        iframe.contentWindow?.postMessage(
          JSON.stringify({ event: "command", func, args }),
          "*",
        );
      };

      const handleMessage = (ev: MessageEvent) => {
        if (ev.source !== iframe.contentWindow) return;
        if (typeof ev.data !== "string") return;
        let data: YTIncomingMessage;
        try {
          data = JSON.parse(ev.data) as YTIncomingMessage;
        } catch {
          return;
        }
        if (!data || typeof data !== "object") return;
        if (data.event === "onReady" || data.event === "initialDelivery") {
          if (!backendReadyRef.current) {
            backendReadyRef.current = true;
            if (pendingRef.current) {
              applyRemote(pendingRef.current);
              pendingRef.current = null;
            }
          }
        }
        // onStateChange historically arrives with `info` as a number, but
        // newer embed builds occasionally wrap it as { playerState: N }.
        // Accept both shapes so play/pause never get silently dropped.
        if (data.event === "onStateChange") {
          let state: number | null = null;
          if (typeof data.info === "number") {
            state = data.info;
          } else if (
            data.info &&
            typeof data.info === "object" &&
            typeof data.info.playerState === "number"
          ) {
            state = data.info.playerState;
          }
          // -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued.
          if (state === 1) {
            isPlaying = true;
            broadcastPlayState(true, lastSampled);
          } else if (state === 2) {
            isPlaying = false;
            broadcastPlayState(false, lastSampled);
          }
        }
        if (
          (data.event === "infoDelivery" || data.event === "initialDelivery") &&
          data.info &&
          typeof data.info === "object" &&
          typeof data.info.currentTime === "number"
        ) {
          const t = data.info.currentTime;
          const expected =
            lastSampled + (isPlaying ? YT_INFO_DELIVERY_SEC : 0);
          if (
            lastSampled > 0 &&
            Math.abs(t - expected) > YT_SEEK_JUMP_SEC
          ) {
            broadcast({ op: "seek", positionSec: t });
          }
          lastSampled = t;
          // Belt-and-suspenders for the YouTube embed: some events that
          // *should* be onStateChange end up only showing up as a
          // playerState field on the next infoDelivery. Treat a change
          // here as authoritative for play/pause sync.
          if (typeof data.info.playerState === "number") {
            const next = data.info.playerState === 1;
            if (next !== isPlaying) {
              isPlaying = next;
              if (data.info.playerState === 1 || data.info.playerState === 2) {
                broadcastPlayState(next, t);
              }
            }
          }
        }
      };
      window.addEventListener("message", handleMessage);

      // Handshake: tell the embed we want to receive events. We send this
      // both immediately and on the iframe's load event because we don't
      // know which fires first across browsers.
      const handshake = () => {
        iframe.contentWindow?.postMessage(
          JSON.stringify({
            event: "listening",
            id: 1,
            channel: "widget",
          }),
          "*",
        );
      };
      iframe.addEventListener("load", handshake);
      const handshakeTimer = setInterval(handshake, 500);
      // Stop retrying once we're ready (cleared in destroy too).
      const stopHandshakeOnReady = setInterval(() => {
        if (backendReadyRef.current) {
          clearInterval(handshakeTimer);
          clearInterval(stopHandshakeOnReady);
        }
      }, 500);

      backendRef.current = {
        play: () => sendCmd("playVideo"),
        pause: () => sendCmd("pauseVideo"),
        seekTo: (sec) => sendCmd("seekTo", [sec, true]),
        getCurrent: () => lastSampled,
        isPaused: () => !isPlaying,
        destroy: () => {
          clearInterval(handshakeTimer);
          clearInterval(stopHandshakeOnReady);
          window.removeEventListener("message", handleMessage);
          iframe.removeEventListener("load", handshake);
          host.innerHTML = "";
        },
      };
      return () => {
        cancelled = true;
        backendReadyRef.current = false;
        backendRef.current?.destroy();
        backendRef.current = null;
      };
    }

    // HTML5 path (mp4 / webm / HLS).
    const video = document.getElementById("wt-html5-video") as
      | HTMLVideoElement
      | null;
    if (!video) return;

    let hlsInstance: { destroy: () => void } | null = null;
    const setupSrc = async () => {
      if (
        source.kind === "url" &&
        source.isHls &&
        video.canPlayType("application/vnd.apple.mpegurl") === ""
      ) {
        try {
          const Hls = (await import("hls.js")).default;
          if (cancelled) return;
          if (!Hls.isSupported()) {
            setLoadError("HLS not supported in this browser");
            return;
          }
          const hls = new Hls();
          hls.loadSource(source.url);
          hls.attachMedia(video);
          hlsInstance = hls;
        } catch (e) {
          if (!cancelled) setLoadError(String(e));
        }
      } else if (source.kind === "url") {
        // Route direct mp4/webm URLs through the Rust-side wt-proxy
        // scheme. Bypasses WKWebView's cross-origin range-seek quirks
        // (moov-at-end mp4s on hosts like pixeldrain) by doing the
        // fetch from reqwest in Rust, then re-serving the bytes via
        // a Tauri custom scheme.
        video.src = `wt-proxy://localhost/${encodeURIComponent(source.url)}`;
      }
    };
    void setupSrc();

    const onPlay = () => {
      if (performance.now() < applyingUntilRef.current) return;
      broadcast({ op: "play", positionSec: video.currentTime });
    };
    const onPause = () => {
      if (performance.now() < applyingUntilRef.current) return;
      broadcast({ op: "pause", positionSec: video.currentTime });
    };
    const onSeeked = () => {
      if (performance.now() < applyingUntilRef.current) return;
      broadcast({ op: "seek", positionSec: video.currentTime });
    };
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("seeked", onSeeked);
    // `<video>` failures are silent by default — the element just shows
    // a broken icon. Surface a real message so the user knows whether
    // it's CORS, an HTML page (e.g. file-sharing album URLs), or a
    // codec the WebView can't decode.
    const onError = () => {
      if (cancelled) return;
      const err = video.error;
      const msg = err
        ? err.code === 4
          ? "The host refused to stream this video here — it may require sign-in, a session cookie from its own page, or a same-site referrer."
          : err.code === 3
            ? "The video is corrupt or its codec isn't supported by this player."
            : err.code === 2
              ? "Network error while loading the video (CORS or the host is offline)."
              : "The video failed to load."
        : "The video failed to load.";
      setLoadError(msg);
    };
    video.addEventListener("error", onError);

    backendRef.current = {
      play: () => void video.play().catch(() => {}),
      pause: () => video.pause(),
      seekTo: (sec) => {
        video.currentTime = sec;
      },
      getCurrent: () => video.currentTime,
      isPaused: () => video.paused,
      destroy: () => {
        video.removeEventListener("play", onPlay);
        video.removeEventListener("pause", onPause);
        video.removeEventListener("seeked", onSeeked);
        video.removeEventListener("error", onError);
        try { video.pause(); } catch { /* ignore */ }
        if (hlsInstance) hlsInstance.destroy();
        video.removeAttribute("src");
        video.load();
      },
    };
    const onLoaded = () => {
      backendReadyRef.current = true;
      if (pendingRef.current) {
        applyRemote(pendingRef.current);
        pendingRef.current = null;
      }
    };
    video.addEventListener("loadedmetadata", onLoaded, { once: true });

    return () => {
      cancelled = true;
      backendReadyRef.current = false;
      video.removeEventListener("loadedmetadata", onLoaded);
      backendRef.current?.destroy();
      backendRef.current = null;
    };
  }, [sourceKey, sendSync, source]);

  // Apply incoming remote sync events to the player. If the backend hasn't
  // loaded yet (YT iframe still booting, HLS still attaching), stash the
  // latest event and apply it on ready — without this, the very first sync
  // burst from the host can be silently dropped.
  useEffect(() => {
    const unsub = subscribeSync((p) => {
      if (p.op === "stop") return;
      if (!backendReadyRef.current) {
        pendingRef.current = p;
        return;
      }
      applyRemote(p);
    });
    return unsub;
  }, [subscribeSync]);

  // Expose current state to useCall so late-joining peers can be brought
  // up to speed on the actual playhead position, not the stale "load" snapshot.
  useEffect(() => {
    setSnapshotProvider(() => ({
      positionSec: backendRef.current?.getCurrent() ?? 0,
      playing: !(backendRef.current?.isPaused() ?? true),
    }));
    return () => setSnapshotProvider(null);
  }, [setSnapshotProvider]);

  return (
    <div className="relative w-full h-full bg-black rounded-xl overflow-hidden">
      {source.kind === "youtube" ? (
        <div id="wt-player-host" className="w-full h-full" />
      ) : (
        <video
          id="wt-html5-video"
          className="w-full h-full object-contain bg-black"
          controls
          playsInline
          // CORS mode — pixeldrain (and most file hosts) return
          // `Access-Control-Allow-Origin: *`, and WebKit handles
          // moov-at-end mp4s more reliably in CORS mode.
          crossOrigin="anonymous"
        />
      )}
      {loadError && (
        <div className="absolute inset-0 grid place-items-center text-xs text-red-300 bg-black/70 p-4 text-center">
          {loadError}
        </div>
      )}
    </div>
  );
}
