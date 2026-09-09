"use client";

// YouTube-style "Stats for nerds" overlay. Renders a compact panel
// in the top-left corner of the player region showing live mpv
// telemetry (codecs, resolution, fps, bitrate, buffer health,
// playback state). Toggled from the settings menu in PlayerControls.
//
// Subscribes directly to `mpv.onState/onTracks/onBuffer` so it stays
// in sync with the engine without going through any intermediate
// React state. `pointer-events-none` so it doesn't intercept the
// click-to-play/pause handler on the player container.

import { useEffect, useState } from "react";
import { mpv, type MpvState, getEventCounts } from "../mpv";
import { useUiFps } from "../playerDebug";

type Track = {
  type: "video" | "audio" | "sub";
  codec?: string;
  "codec-desc"?: string;
  "codec-profile"?: string;
  selected?: boolean;
  "demux-w"?: number;
  "demux-h"?: number;
  "demux-fps"?: number;
  "demux-bitrate"?: number;
  "demux-channel-count"?: number;
  "demux-channels"?: string;
  "demux-samplerate"?: number;
};

type BufferInfo = {
  "cache-duration"?: number;
  "cache-end"?: number;
  "total-bytes"?: number;
  "fw-bytes"?: number;
  underrun?: boolean;
  idle?: boolean;
  eof?: boolean;
};

function parseTracks(json: string): Track[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json) as Track[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function parseBuffer(json: string): BufferInfo {
  if (!json) return {};
  try {
    return JSON.parse(json) as BufferInfo;
  } catch {
    return {};
  }
}

function formatBytes(b: number | undefined): string {
  if (b == null) return "—";
  if (b > 1_073_741_824) return `${(b / 1_073_741_824).toFixed(2)} GB`;
  if (b > 1_048_576) return `${(b / 1_048_576).toFixed(1)} MB`;
  if (b > 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${b} B`;
}

function formatTime(s: number | null | undefined): string {
  if (s == null || !Number.isFinite(s)) return "—";
  const m = Math.floor(s / 60);
  const ss = (s % 60).toFixed(2).padStart(5, "0");
  return `${m}:${ss}`;
}

export function PlayerStatsOverlay({ visible }: { visible: boolean }) {
  const [state, setState] = useState<MpvState | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [buffer, setBuffer] = useState<BufferInfo>({});
  // Viewport size is read in a client-only effect so SSR doesn't
  // hydrate-mismatch on `window.innerWidth`.
  const [viewport, setViewport] = useState<{ w: number; h: number; dpr: number } | null>(null);
  const uiFps = useUiFps(visible);

  useEffect(() => mpv.onState(setState), []);
  useEffect(() => mpv.onTracks((j) => setTracks(parseTracks(j))), []);
  useEffect(() => mpv.onBuffer((j) => setBuffer(parseBuffer(j))), []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const upd = () =>
      setViewport({
        w: window.innerWidth,
        h: window.innerHeight,
        dpr: window.devicePixelRatio,
      });
    upd();
    window.addEventListener("resize", upd);
    return () => window.removeEventListener("resize", upd);
  }, []);

  if (!visible) return null;

  const video = tracks.find((t) => t.type === "video" && t.selected);
  const audio = tracks.find((t) => t.type === "audio" && t.selected);
  const sub = tracks.find((t) => t.type === "sub" && t.selected);
  const subCount = tracks.filter((t) => t.type === "sub").length;
  const audioCount = tracks.filter((t) => t.type === "audio").length;

  const videoLine = video
    ? [
        video.codec ?? "?",
        video["demux-w"] && video["demux-h"]
          ? `${video["demux-w"]}×${video["demux-h"]}`
          : null,
        video["demux-fps"] ? `${video["demux-fps"].toFixed(2)}fps` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "—";

  const audioLine = audio
    ? [
        audio.codec ?? "?",
        audio["demux-channels"] ?? null,
        audio["demux-samplerate"]
          ? `${(audio["demux-samplerate"] / 1000).toFixed(1)}kHz`
          : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "—";

  const videoBitrate = video?.["demux-bitrate"];
  const audioBitrate = audio?.["demux-bitrate"];
  const cacheDur = buffer["cache-duration"];
  const totalBytes = buffer["total-bytes"];
  const fwBytes = buffer["fw-bytes"];
  // Cache-progress %: how full the cache is vs the file. Only
  // meaningful when total file size is bigger than current cache.
  const cachePct =
    cacheDur != null && state?.duration != null && state.duration > 0
      ? Math.min(100, Math.max(0, ((state.time_pos ?? 0) + cacheDur) / state.duration * 100))
      : null;

  const events = getEventCounts();

  return (
    <div className="absolute top-3 left-3 z-20 pointer-events-none">
      <div className="bg-black/85 rounded-lg px-3 py-2 text-[10.5px] font-mono text-neutral-200 leading-snug min-w-[300px] max-w-[420px]">
        <div className="flex items-center justify-between mb-1.5 select-none">
          <span className="text-[9.5px] uppercase tracking-[0.12em] text-neutral-500">
            Stats for nerds
          </span>
          <span
            className={
              uiFps >= 55
                ? "text-emerald-300 text-[10px]"
                : uiFps >= 30
                  ? "text-amber-300 text-[10px]"
                  : "text-rose-400 text-[10px]"
            }
          >
            ui {uiFps}fps
          </span>
        </div>

        <Row label="Video">{videoLine}</Row>
        {video?.["codec-profile"] && (
          <Row label="Profile" muted>
            {video["codec-profile"]}
          </Row>
        )}
        {video?.["codec-desc"] && video["codec-desc"] !== video.codec && (
          <Row label="Codec" muted>
            {video["codec-desc"]}
          </Row>
        )}
        <Row label="Audio">
          {audioLine}
          {audioCount > 1 && (
            <span className="text-neutral-500"> ({audioCount} tracks)</span>
          )}
        </Row>
        <Row label="Subs">
          {sub ? sub.codec ?? "?" : <span className="text-neutral-500">off</span>}
          {subCount > 0 && (
            <span className="text-neutral-500">
              {" "}
              ({subCount} available)
            </span>
          )}
        </Row>
        {(videoBitrate != null || audioBitrate != null) && (
          <Row label="Bitrate">
            {videoBitrate != null
              ? `${(videoBitrate / 1000).toFixed(0)}k v`
              : ""}
            {videoBitrate != null && audioBitrate != null ? " · " : ""}
            {audioBitrate != null
              ? `${(audioBitrate / 1000).toFixed(0)}k a`
              : ""}
          </Row>
        )}
        <Row label="Position">
          {formatTime(state?.time_pos)} / {formatTime(state?.duration)}
        </Row>
        <Row label="Buffer">
          {cacheDur != null ? `${cacheDur.toFixed(1)}s` : "—"} ·{" "}
          {formatBytes(totalBytes)}
          {fwBytes != null && (
            <span className="text-neutral-500">
              {" "}
              ({formatBytes(fwBytes)} ahead)
            </span>
          )}
        </Row>
        {cachePct != null && (
          <Row label="Cached" muted>
            {cachePct.toFixed(1)}% of stream
          </Row>
        )}
        <Row label="State">
          <span
            className={
              state?.paused
                ? "text-amber-300"
                : state?.eof
                  ? "text-rose-300"
                  : "text-emerald-300"
            }
          >
            {state?.paused
              ? "paused"
              : state?.eof
                ? "ended"
                : "playing"}
          </span>
          {buffer.underrun && (
            <span className="text-rose-400"> · underrun</span>
          )}
          {buffer.idle && state?.paused === false && (
            <span className="text-neutral-500"> · idle</span>
          )}
        </Row>
        <Row label="Volume" muted>
          {state?.volume != null ? `${Math.round(state.volume)}%` : "—"}
          {state?.muted ? " (muted)" : ""}
        </Row>

        <div className="my-1.5 border-t border-white/[0.06]" />

        <Row label="Viewport" muted>
          {viewport
            ? `${viewport.w}×${viewport.h} (dpr ${viewport.dpr})`
            : "…"}
        </Row>
        <Row label="mpv events" muted>
          state {events.stateHz}/s · tracks {events.tracks} · buf{" "}
          {events.buffer} · eof {events.eof}
        </Row>
      </div>
    </div>
  );
}

function Row({
  label,
  children,
  muted,
}: {
  label: string;
  children: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <div
      className={
        muted
          ? "flex gap-2 items-baseline text-neutral-400"
          : "flex gap-2 items-baseline"
      }
    >
      <span className="text-neutral-500 shrink-0 w-[58px]">{label}</span>
      <span className="break-all">{children}</span>
    </div>
  );
}
