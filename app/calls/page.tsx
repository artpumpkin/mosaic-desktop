"use client";
import { useEffect, useRef, useState } from "react";
import {
  PhoneCall,
  PhoneOff,
  Mic,
  MicOff,
  Video,
  VideoOff,
  MonitorUp,
  MonitorOff,
  Copy,
  Check,
  Shuffle,
  Sliders,
  Bookmark,
  BookmarkCheck,
  MessageSquare,
  Maximize2,
  Minimize2,
  Tv,
  TvMinimal,
  Crown,
  UserMinus,
  Volume2,
  VolumeX,
  type LucideIcon,
} from "lucide-react";
import clsx from "clsx";
import GlassCard from "@/components/GlassCard";
import PageHeader from "@/components/PageHeader";
import { useCall } from "@/lib/calls/useCall";
import { toast } from "@/lib/toast";
import ChatPanel from "@/components/calls/ChatPanel";
import ViewControls from "@/components/calls/ViewControls";
import WatchPartyViewport, {
  type WatchPartyViewportHandle,
  type TileId,
} from "@/components/calls/WatchPartyViewport";
import WatchTogetherPlayer from "@/components/calls/WatchTogetherPlayer";
import type { WtSource } from "@/lib/calls/types";
import ProfileCard from "@/components/calls/ProfileCard";
import SavedRoomsList from "@/components/calls/SavedRoomsList";
import {
  DEFAULT_PREFS,
  loadPrefs,
  savePrefs,
  type ViewPrefs,
} from "@/lib/calls/viewPrefs";
import {
  DEFAULT_PROFILE,
  loadProfile,
  saveProfile,
  displayName,
  type Profile,
} from "@/lib/calls/profile";
import {
  loadSavedRooms,
  addRoom,
  renameRoom,
  removeRoom,
  touchRoom,
  findByCode,
  type SavedRoom,
} from "@/lib/calls/savedRooms";
import { useFullWidth } from "@/lib/appLayout";
import { playChatPing } from "@/lib/calls/notify";

type ResolveResult =
  | { ok: true; source: WtSource }
  | { ok: false; error: string };

// Pull a pixeldrain file id out of any of its URL shapes — share page,
// album item, direct API. Returns null if this doesn't look like a
// pixeldrain link we can resolve.
function extractPixeldrainFileId(parsed: URL): string | null {
  if (parsed.hostname.replace(/^www\./, "") !== "pixeldrain.net") return null;
  // /u/{id} — the share page
  const u = parsed.pathname.match(/^\/u\/([\w-]+)/);
  if (u) return u[1];
  // /api/file/{id} — the direct API
  const api = parsed.pathname.match(/^\/api\/file\/([\w-]+)/);
  if (api) return api[1];
  // /l/{album}#item=N — album item: fragment tells us which file, but
  // we'd need to fetch the album manifest to resolve it. Bail.
  return null;
}

// Resolve a URL the user pasted into a fully-formed WtSource. Handles
// the various YouTube URL shapes synchronously; for hosting services
// like pixeldrain it does an async HEAD-style metadata fetch to verify
// the file is a video and to substitute the right streaming URL when
// the user pasted a share page instead of a direct file link.
async function resolveWatchSource(raw: string): Promise<ResolveResult> {
  const url = raw.trim();
  if (!url) return { ok: false, error: "Paste a URL first." };
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: "That doesn't look like a valid URL." };
  }
  const host = parsed.hostname.replace(/^www\./, "");

  if (host === "youtu.be") {
    const id = parsed.pathname.slice(1).split("/")[0];
    if (id) return { ok: true, source: { kind: "youtube", videoId: id } };
    return { ok: false, error: "Couldn't find a video ID in that YouTube URL." };
  }
  if (host === "youtube.com" || host === "m.youtube.com") {
    const v = parsed.searchParams.get("v");
    if (v) return { ok: true, source: { kind: "youtube", videoId: v } };
    const m = parsed.pathname.match(/^\/(shorts|embed|live)\/([\w-]+)/);
    if (m) return { ok: true, source: { kind: "youtube", videoId: m[2] } };
    return { ok: false, error: "Couldn't find a video ID in that YouTube URL." };
  }

  // Pixeldrain: fetch the file's metadata to confirm it's a video and to
  // get a canonical streaming URL. For album URLs (`/l/{id}`), read the
  // album manifest and pick the file the `#item=N` fragment refers to
  // (0-indexed; defaults to the first item). Saves us from a generic
  // "couldn't decode" error when the user pastes a non-video file.
  if (host === "pixeldrain.net") {
    const albumMatch = parsed.pathname.match(/^\/l\/([\w-]+)/);
    if (albumMatch) {
      const albumId = albumMatch[1];
      const fragMatch = parsed.hash.match(/item=(\d+)/);
      const itemIdx = fragMatch ? parseInt(fragMatch[1], 10) : 0;
      try {
        const res = await fetch(
          `https://pixeldrain.net/api/list/${albumId}`,
        );
        if (!res.ok) {
          return {
            ok: false,
            error: `Pixeldrain returned ${res.status} for that album — is it public?`,
          };
        }
        const album = (await res.json()) as {
          files?: Array<{ id: string; mime_type?: string; name?: string }>;
        };
        const files = album.files;
        if (!Array.isArray(files) || files.length === 0) {
          return { ok: false, error: "That pixeldrain album is empty." };
        }
        if (itemIdx < 0 || itemIdx >= files.length) {
          return {
            ok: false,
            error: `That album has ${files.length} files; you asked for item ${itemIdx}.`,
          };
        }
        const item = files[itemIdx];
        const mime = item.mime_type ?? "";
        if (!mime.startsWith("video/")) {
          return {
            ok: false,
            error: `Item ${itemIdx} (${item.name ?? "?"}) is ${mime || "an unknown type"}, not a video.`,
          };
        }
        return {
          ok: true,
          source: {
            kind: "url",
            url: `https://pixeldrain.net/api/file/${item.id}`,
            isHls: false,
          },
        };
      } catch (e) {
        return {
          ok: false,
          error: `Couldn't reach pixeldrain: ${e instanceof Error ? e.message : String(e)}`,
        };
      }
    }

    const fileId = extractPixeldrainFileId(parsed);
    if (!fileId) {
      return {
        ok: false,
        error:
          "Couldn't recognize this pixeldrain link. Paste a /u/{id} share URL or an /l/{id} album URL.",
      };
    }
    try {
      const res = await fetch(
        `https://pixeldrain.net/api/file/${fileId}/info`,
      );
      if (!res.ok) {
        return {
          ok: false,
          error: `Pixeldrain returned ${res.status} for that file — is it public?`,
        };
      }
      const info = (await res.json()) as { mime_type?: string };
      const mime = info.mime_type ?? "";
      if (!mime.startsWith("video/")) {
        return {
          ok: false,
          error: `That pixeldrain file is ${mime || "an unknown type"}, not a video.`,
        };
      }
      return {
        ok: true,
        source: {
          kind: "url",
          url: `https://pixeldrain.net/api/file/${fileId}`,
          isHls: false,
        },
      };
    } catch (e) {
      return {
        ok: false,
        error: `Couldn't reach pixeldrain: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }

  const isHls = /\.m3u8($|\?)/i.test(parsed.pathname + parsed.search);
  return { ok: true, source: { kind: "url", url, isHls } };
}

function makeRoomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += alphabet[bytes[i] % alphabet.length];
    if (i === 3) out += "-";
  }
  return out;
}

// Dedicated audio sink for a remote stream. Stays mounted at the top of
// the call panel regardless of layout, so audio playback doesn't depend
// on whether the matching <video> tile is currently visible / not
// remounted by layout changes. (Fixes audio cutting out when toggling
// camera off, switching layouts, or going fullscreen.)
//
// `volume` is 0..1 and is applied imperatively (HTMLMediaElement.volume,
// not a React-controlled prop) so the slider stays buttery under drag.
// `muted` cuts audio without losing the volume the user chose.
function RemoteAudioSink({
  stream,
  volume,
  muted,
}: {
  stream: MediaStream | null;
  volume: number;
  muted: boolean;
}) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = stream;
    if (stream) void el.play().catch(() => {});
  }, [stream]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.volume = Math.min(1, Math.max(0, volume));
    el.muted = muted;
  }, [volume, muted]);
  return <audio ref={ref} autoPlay style={{ display: "none" }} />;
}

type FitMode = "cover" | "contain";

// Single source of truth for what we render over a tile (local or
// remote). The remote tile passes a full overlay including volume +
// kick; the local tile passes just enough to render the crown and
// (optionally) a mic-off chip.
export type PeerOverlay = {
  isHost: boolean;
  micOn: boolean;
  camOn: boolean;
  /** Volume controls — only set on remote tiles. */
  volume?: number;
  muted?: boolean;
  onVolumeChange?: (v: number) => void;
  onToggleMute?: () => void;
  /** Kick button — set only when *we* are the host and target is remote. */
  onKick?: () => void;
};

function PeerCrown({ size = 12 }: { size?: number }) {
  return (
    <span
      className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-amber-400/90 text-amber-950"
      title="Room owner"
      aria-label="Room owner"
    >
      <Crown size={size} />
    </span>
  );
}

function VolumePopover({
  volume,
  muted,
  onVolumeChange,
  onToggleMute,
}: {
  volume: number;
  muted: boolean;
  onVolumeChange: (v: number) => void;
  onToggleMute: () => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  // Click-outside to dismiss — keeping the popover anchored inside the tile.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);
  const Icon = muted || volume === 0 ? VolumeX : Volume2;
  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Peer volume"
        title="Peer volume"
        className="grid place-items-center w-7 h-7 rounded-md bg-black/60 hover:bg-black/80 backdrop-blur text-white/80 transition"
      >
        <Icon size={13} />
      </button>
      {open && (
        <div
          className="absolute bottom-full right-0 mb-1.5 w-44 rounded-lg bg-neutral-900 border border-white/10 shadow-2xl p-2 flex items-center gap-2 z-10"
          role="dialog"
          aria-label="Adjust peer volume"
        >
          <button
            type="button"
            onClick={onToggleMute}
            aria-label={muted ? "Unmute peer" : "Mute peer"}
            className="grid place-items-center w-7 h-7 shrink-0 rounded-md bg-white/5 hover:bg-white/10 text-white/80"
          >
            {muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
          </button>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(volume * 100)}
            onChange={(e) => onVolumeChange(Number(e.target.value) / 100)}
            className="flex-1 accent-violet-400 cursor-pointer"
            aria-label="Volume"
          />
          <span className="text-[10px] text-neutral-400 tabular-nums w-7 text-right">
            {Math.round(volume * 100)}
          </span>
        </div>
      )}
    </div>
  );
}

function CamTile({
  stream,
  muted,
  label,
  placeholder,
  mirror = false,
  accent,
  className,
  fit = "cover",
  onToggleFit,
  overlay,
}: {
  stream: MediaStream | null;
  muted: boolean;
  label?: string;
  placeholder?: string;
  mirror?: boolean;
  accent?: string;
  className?: string;
  fit?: FitMode;
  onToggleFit?: () => void;
  overlay?: PeerOverlay;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const bgRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.srcObject = stream;
    const bg = bgRef.current;
    if (bg) bg.srcObject = stream;
  }, [stream]);
  // Treat cam-off as "no usable video" — the peer's track is still
  // flowing but disabled, so it renders as a black frame. Showing the
  // placeholder is clearer than a black void.
  const camOff = !!overlay && !overlay.camOn;
  return (
    <div
      className={clsx(
        "relative overflow-hidden bg-black/60 border border-white/10",
        className,
      )}
    >
      {stream && !camOff && (
        <video
          ref={bgRef}
          autoPlay
          playsInline
          muted
          aria-hidden
          className={clsx(
            "absolute inset-0 w-full h-full object-cover scale-110 blur-2xl pointer-events-none transition-opacity duration-200",
            fit === "contain" ? "opacity-60" : "opacity-0",
            mirror && "scale-x-[-1.1]",
          )}
        />
      )}
      <video
        ref={ref}
        autoPlay
        playsInline
        muted={muted}
        style={{ background: "transparent" }}
        className={clsx(
          "absolute inset-0 w-full h-full",
          fit === "cover" ? "object-cover" : "object-contain",
          mirror && "scale-x-[-1]",
          camOff && "opacity-0",
        )}
      />
      {(!stream || camOff) && (
        <div className="absolute inset-0 grid place-items-center text-sm text-neutral-500">
          {camOff ? (
            <div className="flex flex-col items-center gap-2">
              <VideoOff size={28} className="text-neutral-400" />
              <span>Camera off</span>
            </div>
          ) : (
            placeholder ?? "No video"
          )}
        </div>
      )}
      {label && (
        <div
          className="absolute bottom-2 left-2 flex items-center gap-1.5 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-md bg-black/60 backdrop-blur"
        >
          {accent && (
            <span
              className="inline-block w-1.5 h-1.5 rounded-full"
              style={{ background: accent }}
            />
          )}
          {label}
          {overlay?.isHost && <PeerCrown />}
          {overlay && !overlay.micOn && (
            <span
              className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-red-500/80 text-white"
              title="Peer's mic is off"
              aria-label="Peer's mic is off"
            >
              <MicOff size={10} />
            </span>
          )}
        </div>
      )}
      {(overlay || (stream && onToggleFit)) && (
        <div className="absolute bottom-2 right-2 flex items-center gap-1.5">
          {overlay?.onVolumeChange && overlay.onToggleMute && (
            <VolumePopover
              volume={overlay.volume ?? 1}
              muted={overlay.muted ?? false}
              onVolumeChange={overlay.onVolumeChange}
              onToggleMute={overlay.onToggleMute}
            />
          )}
          {overlay?.onKick && (
            <button
              type="button"
              onClick={overlay.onKick}
              aria-label="Remove peer from call"
              title="Remove peer from call"
              className="grid place-items-center w-7 h-7 rounded-md bg-red-500/70 hover:bg-red-500/90 text-white transition"
            >
              <UserMinus size={13} />
            </button>
          )}
          {stream && onToggleFit && (
            <button
              type="button"
              onClick={onToggleFit}
              aria-label={fit === "cover" ? "Show full video" : "Fill tile"}
              title={fit === "cover" ? "Show full video" : "Fill tile"}
              className="grid place-items-center w-8 h-8 rounded-md bg-black/60 hover:bg-black/80 backdrop-blur text-white/80 transition"
            >
              {fit === "cover" ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ControlButton({
  onClick,
  active,
  danger,
  label,
  icon: Icon,
  innerRef,
  badge,
}: {
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
  label: string;
  icon: LucideIcon;
  innerRef?: React.RefObject<HTMLButtonElement | null>;
  badge?: number;
}) {
  return (
    <button
      ref={innerRef}
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={clsx(
        "relative grid place-items-center w-12 h-12 rounded-full transition",
        danger
          ? "bg-red-500 hover:bg-red-400 text-white"
          : active
            ? "bg-white/10 hover:bg-white/15 text-white"
            : "bg-red-500/20 hover:bg-red-500/30 text-red-200 ring-1 ring-red-400/30",
      )}
    >
      <Icon size={18} />
      {badge !== undefined && badge > 0 && (
        <span
          aria-hidden
          className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 grid place-items-center text-[10px] font-semibold rounded-full bg-violet-500 text-white ring-2 ring-black/40"
        >
          {badge > 9 ? "9+" : badge}
        </span>
      )}
    </button>
  );
}

export default function CallsPage() {
  const call = useCall();
  useFullWidth(call.state !== "idle");
  const [joinInput, setJoinInput] = useState("");
  const [copied, setCopied] = useState(false);
  const [chatCollapsed, setChatCollapsed] = useState(true);
  const [localFit, setLocalFit] = useState<FitMode>("cover");
  const [remoteFit, setRemoteFit] = useState<FitMode>("cover");
  const [unreadCount, setUnreadCount] = useState(0);
  const prevMsgCountRef = useRef(0);
  const [viewControlsOpen, setViewControlsOpen] = useState(false);
  const [prefs, setPrefs] = useState<ViewPrefs>(DEFAULT_PREFS);
  const [pinned, setPinned] = useState<TileId | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [profile, setProfileState] = useState<Profile>(DEFAULT_PROFILE);
  const [savedRooms, setSavedRooms] = useState<SavedRoom[]>([]);
  const [saveDraftOpen, setSaveDraftOpen] = useState(false);
  const [saveDraftName, setSaveDraftName] = useState("");
  // Per-call peer volume/mute (0..1, default 1). Not persisted across
  // calls because the peer ID changes each session anyway; it's a
  // moment-in-time preference, like a Discord call.
  const [peerVolume, setPeerVolume] = useState(1);
  const [peerMuted, setPeerMuted] = useState(false);
  const viewportRef = useRef<WatchPartyViewportHandle>(null);
  const viewControlsBtnRef = useRef<HTMLButtonElement | null>(null);
  const watchBtnRef = useRef<HTMLButtonElement | null>(null);
  const [watchPopoverOpen, setWatchPopoverOpen] = useState(false);
  const [watchUrlDraft, setWatchUrlDraft] = useState("");
  const [watchUrlError, setWatchUrlError] = useState<string | null>(null);

  // Hydrate from localStorage on mount (avoid SSR mismatch).
  useEffect(() => {
    setPrefs(loadPrefs());
    setProfileState(loadProfile());
    setSavedRooms(loadSavedRooms());
  }, []);

  // Persist on every change.
  useEffect(() => {
    savePrefs(prefs);
  }, [prefs]);

  // Persist profile + broadcast to peer if in a call.
  const updateProfile = (next: Profile) => {
    setProfileState(next);
    saveProfile(next);
    if (call.state === "live" || call.state === "connecting") {
      call.broadcastProfile(next);
    }
  };

  // Refresh saved-room timestamp when the current call's code matches one.
  useEffect(() => {
    if (call.roomCode && call.state === "live") {
      setSavedRooms(touchRoom(call.roomCode));
    }
  }, [call.roomCode, call.state]);

  const currentSaved = call.roomCode
    ? findByCode(savedRooms, call.roomCode)
    : null;

  // When the call ends, clear pin so the next call starts fresh.
  useEffect(() => {
    if (call.state === "idle") {
      setPinned(null);
      // Reset peer-volume tweaks too — next call is with a fresh peer.
      setPeerVolume(1);
      setPeerMuted(false);
    }
  }, [call.state]);

  // Hide the popover the moment its anchor button disappears (peer stops
  // sharing while it's open) so we don't leave it floating in the void.
  const hasAnyShareOrPin =
    !!call.localScreenStream ||
    !!call.remoteScreenStream ||
    pinned !== null ||
    !!call.watchSource;
  useEffect(() => {
    if (!hasAnyShareOrPin && viewControlsOpen) setViewControlsOpen(false);
  }, [hasAnyShareOrPin, viewControlsOpen]);

  // Reset unread tracking when leaving a call.
  useEffect(() => {
    if (call.state === "idle") {
      prevMsgCountRef.current = 0;
      setUnreadCount(0);
    }
  }, [call.state]);

  // Watch for new peer messages. Ping + badge when chat is hidden.
  useEffect(() => {
    const total = call.messages.length;
    if (total > prevMsgCountRef.current) {
      const fresh = call.messages.slice(prevMsgCountRef.current);
      const newFromPeer = fresh.filter((m) => m.from === "peer").length;
      if (newFromPeer > 0 && chatCollapsed) {
        setUnreadCount((u) => u + newFromPeer);
        playChatPing();
      }
    }
    prevMsgCountRef.current = total;
  }, [call.messages, chatCollapsed]);

  // Clear unread the moment chat opens.
  useEffect(() => {
    if (!chatCollapsed) setUnreadCount(0);
  }, [chatCollapsed]);

  const handleGenerate = () => {
    const code = makeRoomCode();
    setJoinInput(code);
    // Whoever clicks Generate is the room owner — broadcast that flag so
    // the joiner sees the crown over our tile and we get the kick button.
    call.start(code, { asHost: true });
  };

  const handleJoin = () => {
    if (!joinInput.trim()) return;
    call.start(joinInput.trim().toUpperCase());
  };

  const handleKickPeer = () => {
    if (!call.isHost) return;
    call.kickPeer();
  };

  const copyCode = async () => {
    if (!call.roomCode) return;
    try {
      await navigator.clipboard.writeText(call.roomCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast("err", "Clipboard unavailable");
    }
  };

  const [watchResolving, setWatchResolving] = useState(false);
  const handleStartWatch = async () => {
    if (watchResolving) return;
    setWatchResolving(true);
    setWatchUrlError(null);
    try {
      const result = await resolveWatchSource(watchUrlDraft);
      if (!result.ok) {
        setWatchUrlError(result.error);
        return;
      }
      call.sendWtSync({
        op: "load",
        source: result.source,
        positionSec: 0,
        playing: true,
      });
      setWatchPopoverOpen(false);
      setWatchUrlDraft("");
    } finally {
      setWatchResolving(false);
    }
  };

  const handleStopWatch = () => {
    call.sendWtSync({ op: "stop" });
  };

  const handleScreenShareClick = () => {
    if (call.isSharingScreen) {
      call.stopScreenShare();
    } else {
      // Always ask for audio — Chromium's display-media picker offers its
      // own "Also share audio" checkbox, so an in-app prompt would be a
      // redundant second step (and on Windows produced a duplicate
      // permission UX).
      void call.startScreenShare({ includeAudio: true });
    }
  };

  const status = (() => {
    switch (call.state) {
      case "connecting":
        return "Waiting for peer to join…";
      case "live":
        return "Connected";
      case "ended":
        return "Call ended";
      default:
        return null;
    }
  })();

  const hasScreen = !!(call.localScreenStream || call.remoteScreenStream);
  // Watch-party viewport kicks in when any screen is being shared, when
  // a watch-together video is loaded, or when the user has pinned
  // something explicitly. Each case wants the same layout controls
  // (spotlight/sideBySide/theater, cam corner, fullscreen, etc).
  const isWatchParty = hasScreen || pinned !== null || !!call.watchSource;

  // Single overlay descriptor reused by both layouts so badges, the
  // crown, volume popover, and the kick button live in the same place.
  const remoteOverlay: PeerOverlay = {
    isHost: call.peerState.isHost,
    micOn: call.peerState.micOn,
    camOn: call.peerState.camOn,
    volume: peerVolume,
    muted: peerMuted,
    onVolumeChange: setPeerVolume,
    onToggleMute: () => setPeerMuted((m) => !m),
    onKick: call.isHost && call.state === "live" ? handleKickPeer : undefined,
  };
  // The local tile gets just the crown — mic/cam state is already
  // visible in the bottom control bar, and volume/kick don't apply.
  const localOverlay: PeerOverlay = {
    isHost: call.isHost,
    micOn: call.micOn,
    camOn: call.camOn,
  };

  if (call.state !== "idle") {
    return (
      <div className="h-screen flex flex-col bg-black/40">
        <div className="px-4 md:px-5 py-2.5 flex flex-wrap items-center justify-between gap-3 border-b border-white/5 shrink-0">
          <div className="flex items-center gap-3">
            <span
              className={clsx(
                "inline-block w-2 h-2 rounded-full",
                call.state === "live"
                  ? "bg-emerald-400 animate-pulse"
                  : call.state === "connecting"
                    ? "bg-amber-400 animate-pulse"
                    : "bg-neutral-500",
              )}
            />
            <span className="text-sm text-neutral-300">{status}</span>
          </div>
          {call.roomCode && (
            <div className="flex items-center gap-2 relative">
              <code className="px-2.5 py-1 rounded-md bg-black/40 border border-white/10 text-xs font-mono tracking-wider">
                {currentSaved?.name ?? call.roomCode}
              </code>
              <button
                type="button"
                onClick={copyCode}
                aria-label="Copy room code"
                className="grid place-items-center w-8 h-8 rounded-md bg-white/5 hover:bg-white/10 transition"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (currentSaved) {
                    setSavedRooms(removeRoom(currentSaved.id));
                    toast("ok", `Removed "${currentSaved.name}"`);
                  } else {
                    setSaveDraftName(call.roomCode ?? "");
                    setSaveDraftOpen(true);
                  }
                }}
                aria-label={currentSaved ? "Remove from saved rooms" : "Save this room"}
                title={currentSaved ? "Remove from saved rooms" : "Save this room"}
                className={clsx(
                  "grid place-items-center w-8 h-8 rounded-md transition",
                  currentSaved
                    ? "bg-violet-500/20 text-violet-200 hover:bg-violet-500/30"
                    : "bg-white/5 hover:bg-white/10",
                )}
              >
                {currentSaved ? (
                  <BookmarkCheck size={14} />
                ) : (
                  <Bookmark size={14} />
                )}
              </button>
              {saveDraftOpen && !currentSaved && (
                <div className="absolute top-full right-0 mt-2 z-20 w-64 rounded-lg bg-neutral-900 border border-white/10 shadow-2xl p-3 space-y-2">
                  <div className="text-xs font-semibold tracking-tight">Save room</div>
                  <input
                    autoFocus
                    type="text"
                    value={saveDraftName}
                    onChange={(e) => setSaveDraftName(e.target.value.slice(0, 48))}
                    placeholder="Name (e.g. Movie night)"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && call.roomCode) {
                        setSavedRooms(addRoom(call.roomCode, saveDraftName));
                        setSaveDraftOpen(false);
                        toast("ok", "Room saved");
                      }
                      if (e.key === "Escape") setSaveDraftOpen(false);
                    }}
                    className="w-full px-2 py-1.5 rounded-md bg-white/5 border border-white/10 text-xs focus:outline-none focus:border-violet-400/40"
                  />
                  <div className="flex gap-2 justify-end">
                    <button
                      type="button"
                      onClick={() => setSaveDraftOpen(false)}
                      className="px-2.5 py-1 rounded-md text-[11px] text-neutral-400 hover:text-neutral-200"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (!call.roomCode) return;
                        setSavedRooms(addRoom(call.roomCode, saveDraftName));
                        setSaveDraftOpen(false);
                        toast("ok", "Room saved");
                      }}
                      className="px-2.5 py-1 rounded-md bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white text-[11px] font-medium"
                    >
                      Save
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <RemoteAudioSink
          stream={call.remoteCamStream}
          volume={peerVolume}
          muted={peerMuted}
        />
        <RemoteAudioSink
          stream={call.remoteScreenStream}
          volume={peerVolume}
          muted={peerMuted}
        />

        <div className="flex-1 min-h-0 flex gap-2 p-2">
          <div className="flex-1 min-w-0 flex flex-col gap-2">
            {isWatchParty ? (
              <WatchPartyViewport
                ref={viewportRef}
                localCamStream={call.localCamStream}
                remoteCamStream={call.remoteCamStream}
                localScreenStream={call.localScreenStream}
                remoteScreenStream={call.remoteScreenStream}
                prefs={prefs}
                onPrefsChange={setPrefs}
                pinned={pinned}
                onPinChange={setPinned}
                onFullscreenChange={setIsFullscreen}
                myProfile={profile}
                peerProfile={call.peerProfile}
                localOverlay={localOverlay}
                remoteOverlay={call.state === "live" ? remoteOverlay : undefined}
                customMain={
                  call.watchSource ? (
                    <WatchTogetherPlayer
                      source={call.watchSource}
                      sendSync={call.sendWtSync}
                      subscribeSync={call.subscribeWtSync}
                      setSnapshotProvider={call.setWtSnapshotProvider}
                    />
                  ) : undefined
                }
              />
            ) : (
              <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-2 gap-2">
                <CamTile
                  stream={call.localCamStream}
                  muted
                  mirror
                  label={profile.name || "You"}
                  accent={profile.color}
                  className="rounded-xl min-h-0"
                  placeholder="Starting camera…"
                  fit={localFit}
                  onToggleFit={() =>
                    setLocalFit((f) => (f === "cover" ? "contain" : "cover"))
                  }
                  overlay={localOverlay}
                />
                <CamTile
                  stream={call.remoteCamStream}
                  muted
                  label={displayName(call.peerProfile, "Peer")}
                  accent={call.peerProfile?.color}
                  className="rounded-xl min-h-0"
                  placeholder={
                    call.state === "live"
                      ? "No incoming video"
                      : "Waiting for peer…"
                  }
                  fit={remoteFit}
                  onToggleFit={() =>
                    setRemoteFit((f) => (f === "cover" ? "contain" : "cover"))
                  }
                  overlay={call.state === "live" ? remoteOverlay : undefined}
                />
              </div>
            )}
          </div>

          {!chatCollapsed && (
            <ChatPanel
              messages={call.messages}
              onSend={call.sendChat}
              collapsed={false}
              onToggleCollapse={() => setChatCollapsed(true)}
              myProfile={profile}
              peerProfile={call.peerProfile}
            />
          )}
        </div>

        <div className="px-4 py-3 flex flex-wrap items-center justify-center gap-3 border-t border-white/5 shrink-0">
          <ControlButton
            onClick={call.toggleMic}
            active={call.micOn}
            label={call.micOn ? "Mute mic" : "Unmute mic"}
            icon={call.micOn ? Mic : MicOff}
          />
          <ControlButton
            onClick={call.toggleCam}
            active={call.camOn}
            label={call.camOn ? "Turn camera off" : "Turn camera on"}
            icon={call.camOn ? Video : VideoOff}
          />
          <ControlButton
            onClick={handleScreenShareClick}
            active={!call.isSharingScreen}
            label={call.isSharingScreen ? "Stop sharing" : "Share screen"}
            icon={call.isSharingScreen ? MonitorOff : MonitorUp}
          />
          <ControlButton
            innerRef={watchBtnRef}
            onClick={() => {
              if (call.watchSource) {
                handleStopWatch();
              } else {
                setWatchPopoverOpen((v) => !v);
                setWatchUrlError(null);
              }
            }}
            active={!call.watchSource}
            label={call.watchSource ? "Stop watching" : "Watch together"}
            icon={call.watchSource ? TvMinimal : Tv}
          />
          <ControlButton
            onClick={() => setChatCollapsed((v) => !v)}
            active={chatCollapsed}
            label={chatCollapsed ? "Open chat" : "Close chat"}
            icon={MessageSquare}
            badge={unreadCount}
          />
          {isWatchParty && (
            <ControlButton
              innerRef={viewControlsBtnRef}
              onClick={() => setViewControlsOpen((v) => !v)}
              active
              label="View controls"
              icon={Sliders}
            />
          )}
          <ControlButton
            onClick={call.hangUp}
            danger
            label="Hang up"
            icon={PhoneOff}
          />
        </div>

        {viewControlsOpen && viewControlsBtnRef.current && (
          <ViewControls
            anchor={viewControlsBtnRef.current}
            prefs={prefs}
            onChange={setPrefs}
            isFullscreen={isFullscreen}
            onToggleFullscreen={() => viewportRef.current?.toggleFullscreen()}
            onClose={() => setViewControlsOpen(false)}
          />
        )}

        {watchPopoverOpen && !call.watchSource && (
          <div
            className="fixed bottom-20 left-1/2 -translate-x-1/2 z-30 w-[22rem] rounded-lg bg-neutral-900 border border-white/10 shadow-2xl p-3 space-y-2"
            role="dialog"
            aria-label="Watch together"
          >
            <div className="text-xs font-semibold tracking-tight">
              Watch together
            </div>
            <input
              autoFocus
              type="url"
              value={watchUrlDraft}
              onChange={(e) => {
                setWatchUrlDraft(e.target.value);
                if (watchUrlError) setWatchUrlError(null);
              }}
              placeholder="YouTube URL, pixeldrain link, or direct .mp4 / .m3u8"
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleStartWatch();
                if (e.key === "Escape") setWatchPopoverOpen(false);
              }}
              disabled={watchResolving}
              className="w-full px-2 py-1.5 rounded-md bg-white/5 border border-white/10 text-xs focus:outline-none focus:border-violet-400/40 disabled:opacity-50"
            />
            {watchUrlError && (
              <div className="text-[11px] text-red-300">{watchUrlError}</div>
            )}
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setWatchPopoverOpen(false)}
                className="px-2.5 py-1 rounded-md text-[11px] text-neutral-400 hover:text-neutral-200"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleStartWatch()}
                disabled={watchResolving}
                className="px-2.5 py-1 rounded-md bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white text-[11px] font-medium disabled:opacity-50"
              >
                {watchResolving ? "Resolving…" : "Watch"}
              </button>
            </div>
            <div className="text-[10.5px] text-neutral-500 leading-relaxed pt-1.5 border-t border-white/5">
              Both peers will play the same video. Anyone can play, pause, or
              seek.
            </div>
          </div>
        )}

        <details className="px-4 pb-2 text-[11px] text-neutral-400 shrink-0">
          <summary className="cursor-pointer select-none text-neutral-500 hover:text-neutral-300">
            Connection diagnostics — ICE:{" "}
            <span className="font-mono">{call.iceState}</span>
          </summary>
          <div className="mt-2 font-mono text-[10.5px] leading-tight bg-black/40 rounded-md p-2 max-h-48 overflow-y-auto space-y-0.5">
            {call.logs.length === 0 ? (
              <div className="text-neutral-600">No events yet…</div>
            ) : (
              call.logs.map((l) => (
                <div key={l.ts + l.msg}>
                  <span className="text-neutral-600">
                    {new Date(l.ts).toLocaleTimeString()}
                  </span>{" "}
                  {l.msg}
                </div>
              ))
            )}
          </div>
        </details>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={PhoneCall}
        title="Calls"
        subtitle="Peer-to-peer audio + video. Share a room code with anyone running Mosaic."
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-4">
        <ProfileCard profile={profile} onChange={updateProfile} />
        <SavedRoomsList
          rooms={savedRooms}
          onJoin={(code) => call.start(code)}
          onRename={(id, name) => setSavedRooms(renameRoom(id, name))}
          onRemove={(id) => setSavedRooms(removeRoom(id))}
        />
        <GlassCard className="space-y-5 lg:col-span-2">
          <div>
            <h2 className="text-sm font-semibold tracking-tight">Start a new call</h2>
            <p className="text-xs text-neutral-400 mt-1">
              Generate a code, send it to the other person, and wait for them to join.
            </p>
            <button
              type="button"
              onClick={handleGenerate}
              className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white text-sm font-medium hover:opacity-90 transition"
            >
              <Shuffle size={15} />
              Generate room code
            </button>
          </div>

          <div className="h-px bg-white/5" />

          <div>
            <h2 className="text-sm font-semibold tracking-tight">Join an existing call</h2>
            <p className="text-xs text-neutral-400 mt-1">
              Enter the room code shared with you.
            </p>
            <div className="mt-3 flex gap-2">
              <input
                type="text"
                value={joinInput}
                onChange={(e) => setJoinInput(e.target.value.toUpperCase())}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleJoin();
                }}
                placeholder="ABCD-EFGH"
                className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm font-mono tracking-wider placeholder:text-neutral-600 focus:outline-none focus:border-violet-400/50"
              />
              <button
                type="button"
                onClick={handleJoin}
                disabled={!joinInput.trim()}
                className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-medium transition"
              >
                Join
              </button>
            </div>
          </div>

          <div className="text-[11px] text-neutral-500 leading-relaxed pt-2 border-t border-white/5">
            Signaling runs over public Nostr relays; media flows directly peer-to-peer
            and is SRTP-encrypted end-to-end. Free public TURN is used as a fallback
            when direct P2P fails (e.g. symmetric NATs).
          </div>
        </GlassCard>
      </div>
    </div>
  );
}
