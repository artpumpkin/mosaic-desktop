"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bug, Copy, Trash2, X } from "lucide-react";
import type { TvChannel, TvStream } from "@/lib/tv/types";
import { radioProxyBase, proxiedRadioUrl } from "@/lib/tv/radio";
import { startRadioAnalyser, type RadioAnalyserHandle } from "@/lib/tv/radioAnalyser";
import RadioStage from "./RadioStage";

type Props = {
  channel: TvChannel;
  stream: TvStream | undefined;
  countryFlag?: string;
  genreLabel?: string | null;
  onError?: (msg: string) => void;
};

// Radio playback engine.
//
// Playback: a plain <audio> element plays the stream natively (audible). We do
// NOT tap it with createMediaElementSource — WKWebView silences that for live
// streams.
//
// Visualization: a separate pipeline (lib/tv/radioAnalyser.ts) fetches the same
// stream through the localhost CORS proxy, decodes it, and feeds an
// AnalyserNode whose spectrum drives the bars. Skipped for HLS (.m3u8, can't
// chunk-decode) and when the proxy is unavailable → ambient visualization.
export default function RadioPlayer({
  channel,
  stream,
  countryFlag,
  genreLabel,
  onError,
}: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const handleRef = useRef<RadioAnalyserHandle | null>(null);

  const [playbackSrc, setPlaybackSrc] = useState<string | null>(null);
  const [analysisUrl, setAnalysisUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);

  // ---- Debug log ---------------------------------------------------------
  const logRef = useRef<string[]>([]);
  const [, bumpLog] = useState(0);
  const [showDebug, setShowDebug] = useState(false);
  const log = useCallback((line: string) => {
    const ts = new Date().toISOString().slice(11, 23);
    logRef.current.push(`[${ts}] ${line}`);
    if (logRef.current.length > 500) logRef.current.shift();
    bumpLog((n) => n + 1);
  }, []);

  const ensureCtx = useCallback((): AudioContext | null => {
    if (ctxRef.current) return ctxRef.current;
    try {
      const Ctx =
        window.AudioContext ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).webkitAudioContext;
      ctxRef.current = new Ctx();
      log(`AudioContext created state=${ctxRef.current!.state}`);
    } catch (e) {
      log(`AudioContext create failed: ${e instanceof Error ? e.message : e}`);
      return null;
    }
    return ctxRef.current;
  }, [log]);

  // Resume the context on the first user gesture (autoplay policy). Created
  // eagerly so a later station pick already has a running context.
  useEffect(() => {
    const onGesture = () => {
      void ensureCtx()?.resume().catch(() => {});
    };
    window.addEventListener("pointerdown", onGesture);
    return () => window.removeEventListener("pointerdown", onGesture);
  }, [ensureCtx]);

  // Station change → set playback source + resolve the analysis (proxied) URL.
  useEffect(() => {
    let cancelled = false;
    const url = stream?.url ?? null;
    setPlaybackSrc(url);
    if (!url) {
      setAnalysisUrl(null);
      log(`station "${channel.name}" → no stream url`);
      return;
    }
    log(`station "${channel.name}" url=${url}`);
    if (/\.m3u8(\?|$)/i.test(url)) {
      // HLS can't be chunk-decoded — play native, no spectrum.
      setAnalysisUrl(null);
      log("HLS stream → native playback, ambient visualization");
      return;
    }
    (async () => {
      const base = await radioProxyBase();
      if (cancelled) return;
      log(`proxy base = ${base || "(none)"}`);
      setAnalysisUrl(base ? proxiedRadioUrl(base, url) : null);
      if (!base) log("no proxy → ambient visualization");
    })();
    return () => {
      cancelled = true;
    };
  }, [stream?.url, channel.name, log]);

  // Drive the <audio> element imperatively.
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    if (!playbackSrc) {
      el.removeAttribute("src");
      el.load();
      return;
    }
    log(`play src=${playbackSrc.slice(0, 90)}`);
    el.src = playbackSrc;
    el.load();
    void el.play().catch((e) => {
      setPlaying(false);
      log(`play() rejected: ${e?.name ?? e}`);
    });
  }, [playbackSrc, log]);

  // Start/stop the analysis pipeline as the analysis URL changes.
  useEffect(() => {
    handleRef.current?.stop();
    handleRef.current = null;
    setAnalyser(null);
    if (!analysisUrl) return;

    let cancelled = false;
    const ctx = ensureCtx();
    if (!ctx) return;
    void ctx.resume().catch(() => {});
    log(`starting analyser (ctx=${ctx.state}) for ${analysisUrl.slice(0, 60)}…`);
    startRadioAnalyser(ctx, analysisUrl, log)
      .then((handle) => {
        if (cancelled) {
          handle.stop();
          return;
        }
        handleRef.current = handle;
        setAnalyser(handle.analyser);
        log("analyser handle ready");
      })
      .catch((e) => log(`analyser start failed: ${e instanceof Error ? e.message : e}`));

    return () => {
      cancelled = true;
      handleRef.current?.stop();
      handleRef.current = null;
    };
  }, [analysisUrl, ensureCtx, log]);

  const onAudioError = useCallback(() => {
    const el = audioRef.current;
    const err = el?.error;
    log(
      `AUDIO ERROR code=${err?.code ?? "?"} msg="${err?.message ?? ""}" net=${el?.networkState}`,
    );
    setPlaying(false);
    onError?.("Stream unavailable");
  }, [onError, log]);

  // Sample the analyser into the debug log.
  useEffect(() => {
    if (!analyser) return;
    const buf = new Uint8Array(analyser.frequencyBinCount);
    const id = window.setInterval(() => {
      analyser.getByteFrequencyData(buf);
      let max = 0;
      let sum = 0;
      let nonZero = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = buf[i];
        if (v > max) max = v;
        if (v > 0) nonZero++;
        sum += v;
      }
      log(
        `fft max=${max} avg=${(sum / buf.length).toFixed(1)} nonZero=${nonZero}/${buf.length} ctx=${ctxRef.current?.state} bins[0..16]=${Array.from(buf.slice(0, 16)).join(",")}`,
      );
    }, 1000);
    return () => window.clearInterval(id);
  }, [analyser, log]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      handleRef.current?.stop();
      ctxRef.current?.close().catch(() => {});
      ctxRef.current = null;
    };
  }, []);

  const copyLogs = useCallback(() => {
    const el = audioRef.current;
    const header = [
      `# Mosaic radio debug`,
      `station: ${channel.name} (${channel.id})`,
      `playback src: ${playbackSrc ?? ""}`,
      `analysis url: ${analysisUrl ?? "(none — ambient)"}`,
      `playing: ${playing}  analyser: ${analyser ? "yes" : "no"}  ctx: ${ctxRef.current?.state ?? "none"}`,
      `audio: readyState=${el?.readyState} networkState=${el?.networkState} currentSrc=${el?.currentSrc ?? ""}`,
      `ua: ${navigator.userAgent}`,
      `---`,
    ].join("\n");
    void navigator.clipboard
      ?.writeText(`${header}\n${logRef.current.join("\n")}`)
      .catch(() => {});
  }, [channel.name, channel.id, playbackSrc, analysisUrl, playing, analyser]);

  return (
    <div className="absolute inset-0">
      <RadioStage
        channel={channel}
        countryFlag={countryFlag}
        genreLabel={genreLabel}
        playing={playing}
        analyser={analyser}
      />

      <button
        type="button"
        onClick={() => setShowDebug((v) => !v)}
        className="absolute bottom-2 right-2 z-20 grid place-items-center w-8 h-8 rounded-lg bg-black/50 hover:bg-black/70 text-neutral-300 border border-white/10 backdrop-blur"
        title="Toggle radio debug log"
        aria-label="Toggle radio debug log"
      >
        <Bug size={14} />
      </button>

      {showDebug && (
        <div className="absolute bottom-12 right-2 z-20 w-[min(560px,calc(100%-1rem))] h-[min(340px,60%)] flex flex-col rounded-xl bg-black/85 border border-white/15 backdrop-blur shadow-2xl">
          <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-white/10">
            <span className="text-[11px] font-semibold text-neutral-200 inline-flex items-center gap-1.5">
              <Bug size={12} /> Radio debug
            </span>
            <span
              className={
                "text-[10px] px-1.5 py-0.5 rounded " +
                (analyser
                  ? "bg-emerald-500/20 text-emerald-300"
                  : "bg-amber-500/20 text-amber-300")
              }
            >
              {analyser ? "analyser live" : "ambient"}
            </span>
            <div className="flex-1" />
            <button
              type="button"
              onClick={copyLogs}
              className="text-[11px] inline-flex items-center gap-1 px-2 py-1 rounded bg-white/10 hover:bg-white/15 text-neutral-200"
              title="Copy logs to clipboard"
            >
              <Copy size={12} /> Copy
            </button>
            <button
              type="button"
              onClick={() => {
                logRef.current = [];
                bumpLog((n) => n + 1);
              }}
              className="text-[11px] inline-flex items-center gap-1 px-2 py-1 rounded bg-white/10 hover:bg-white/15 text-neutral-200"
              title="Clear logs"
            >
              <Trash2 size={12} /> Clear
            </button>
            <button
              type="button"
              onClick={() => setShowDebug(false)}
              className="grid place-items-center w-6 h-6 rounded bg-white/10 hover:bg-white/15 text-neutral-200"
              aria-label="Close debug"
            >
              <X size={12} />
            </button>
          </div>
          <pre className="flex-1 min-h-0 overflow-auto p-2 text-[10.5px] leading-[1.35] text-neutral-300 font-mono whitespace-pre-wrap break-all select-text">
            {logRef.current.length
              ? logRef.current.join("\n")
              : "(no log entries yet — pick a station)"}
          </pre>
        </div>
      )}

      {/* Native playback only — never tapped by Web Audio (WKWebView silences
          createMediaElementSource for live streams). */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio
        ref={audioRef}
        onPlaying={() => {
          setPlaying(true);
          log("event: playing");
        }}
        onPause={() => {
          setPlaying(false);
          log("event: pause");
        }}
        onWaiting={() => {
          setPlaying(false);
          log("event: waiting");
        }}
        onStalled={() => log("event: stalled")}
        onError={onAudioError}
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          opacity: 0,
          pointerEvents: "none",
          bottom: 0,
          left: 0,
        }}
      />
    </div>
  );
}
