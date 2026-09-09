"use client";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import {
  Crown,
  MicOff,
  Pin,
  PinOff,
  UserMinus,
  VideoOff,
  Volume2,
  VolumeX,
} from "lucide-react";
import {
  CAM_TILE_WIDTHS,
  SPLIT_MAX,
  SPLIT_MIN,
  type Corner,
  type ViewPrefs,
} from "@/lib/calls/viewPrefs";
import { displayName, type Profile } from "@/lib/calls/profile";

export type TileId = "localCam" | "remoteCam" | "localScreen" | "remoteScreen";

// Mirrors PeerOverlay in app/calls/page.tsx but kept local to avoid a
// circular import; treated as structurally compatible at the boundary.
export type ViewportPeerOverlay = {
  isHost: boolean;
  micOn: boolean;
  camOn: boolean;
  volume?: number;
  muted?: boolean;
  onVolumeChange?: (v: number) => void;
  onToggleMute?: () => void;
  onKick?: () => void;
};

export type WatchPartyViewportHandle = {
  toggleFullscreen: () => void;
  isFullscreen: boolean;
};

const SNAP_RADIUS = 80;

// A stream whose video tracks have all ended is effectively dead — it will
// render as a black <video> if passed to srcObject. Treat it as absent so
// we never produce a ghost tile when a peer's screen-share track ends
// without firing a Trystero/`onPeerLeave` event.
function hasLiveVideo(stream: MediaStream | null): boolean {
  if (!stream) return false;
  const tracks = stream.getVideoTracks();
  if (tracks.length === 0) return false;
  return tracks.some((t) => t.readyState === "live");
}

function VideoBox({
  stream,
  muted,
  mirror = false,
  fit,
  className,
  placeholder,
  camOff,
}: {
  stream: MediaStream | null;
  muted: boolean;
  mirror?: boolean;
  fit: "cover" | "contain";
  className?: string;
  placeholder?: string;
  // Hide the video and show a "camera off" placeholder. Different from
  // !stream because the track is still flowing — just disabled.
  camOff?: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = stream;
  }, [stream]);
  return (
    <div className={clsx("relative overflow-hidden bg-black", className)}>
      <video
        ref={ref}
        autoPlay
        playsInline
        muted={muted}
        className={clsx(
          "w-full h-full",
          fit === "cover" ? "object-cover" : "object-contain",
          mirror && "scale-x-[-1]",
          camOff && "opacity-0",
        )}
      />
      {(!stream || camOff) && (
        <div className="absolute inset-0 grid place-items-center text-xs text-neutral-500">
          {camOff ? (
            <div className="flex flex-col items-center gap-1.5">
              <VideoOff size={20} className="text-neutral-400" />
              <span>Camera off</span>
            </div>
          ) : (
            placeholder
          )}
        </div>
      )}
    </div>
  );
}

function ViewportVolumePopover({
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
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-label="Peer volume"
        title="Peer volume"
        className="grid place-items-center w-6 h-6 rounded-md bg-black/60 hover:bg-black/80 backdrop-blur text-white/80 transition"
      >
        <Icon size={11} />
      </button>
      {open && (
        <div
          className="absolute bottom-full right-0 mb-1.5 w-44 rounded-lg bg-neutral-900 border border-white/10 shadow-2xl p-2 flex items-center gap-2 z-20"
          role="dialog"
          aria-label="Adjust peer volume"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={onToggleMute}
            aria-label={muted ? "Unmute peer" : "Mute peer"}
            className="grid place-items-center w-6 h-6 shrink-0 rounded-md bg-white/5 hover:bg-white/10 text-white/80"
          >
            {muted ? <VolumeX size={11} /> : <Volume2 size={11} />}
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

function Tile({
  id,
  stream,
  label,
  accent,
  muted,
  mirror,
  fit,
  pinned,
  onPin,
  showPin,
  className,
  overlay,
}: {
  id: TileId;
  stream: MediaStream | null;
  label: string;
  accent?: string;
  muted: boolean;
  mirror?: boolean;
  fit: "cover" | "contain";
  pinned: TileId | null;
  onPin: (id: TileId | null) => void;
  showPin: boolean;
  className?: string;
  overlay?: ViewportPeerOverlay;
}) {
  const isPinned = pinned === id;
  // Only show cam-off state on actual cam tiles — overlay flags don't
  // apply to a screen-share tile (the screen stream is independent).
  const isCamTile = id === "localCam" || id === "remoteCam";
  const camOff = isCamTile && !!overlay && !overlay.camOn;
  return (
    <div className={clsx("group relative rounded-lg overflow-hidden", className)}>
      <VideoBox
        stream={stream}
        muted={muted}
        mirror={mirror}
        fit={fit}
        className="w-full h-full"
        placeholder={label}
        camOff={camOff}
      />
      <div className="absolute bottom-1 left-1.5 flex items-center gap-1 text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-black/60 backdrop-blur">
        {accent && (
          <span
            className="inline-block w-1.5 h-1.5 rounded-full"
            style={{ background: accent }}
          />
        )}
        {label}
        {isCamTile && overlay?.isHost && (
          <span
            className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-amber-400/90 text-amber-950"
            title="Room owner"
            aria-label="Room owner"
          >
            <Crown size={9} />
          </span>
        )}
        {isCamTile && overlay && !overlay.micOn && (
          <span
            className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-red-500/80 text-white"
            title="Peer's mic is off"
            aria-label="Peer's mic is off"
          >
            <MicOff size={8} />
          </span>
        )}
      </div>
      {showPin && (
        <button
          type="button"
          onClick={() => onPin(isPinned ? null : id)}
          aria-label={isPinned ? "Unpin" : "Pin as main"}
          className={clsx(
            "absolute top-1.5 left-1.5 grid place-items-center w-6 h-6 rounded-md transition",
            isPinned
              ? "bg-violet-500 text-white opacity-100"
              : "bg-black/60 text-white opacity-0 group-hover:opacity-100",
          )}
        >
          {isPinned ? <PinOff size={12} /> : <Pin size={12} />}
        </button>
      )}
      {isCamTile && overlay && (
        <div className="absolute top-1.5 right-1.5 flex items-center gap-1">
          {overlay.onVolumeChange && overlay.onToggleMute && (
            <ViewportVolumePopover
              volume={overlay.volume ?? 1}
              muted={overlay.muted ?? false}
              onVolumeChange={overlay.onVolumeChange}
              onToggleMute={overlay.onToggleMute}
            />
          )}
          {overlay.onKick && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                overlay.onKick?.();
              }}
              aria-label="Remove peer from call"
              title="Remove peer from call"
              className="grid place-items-center w-6 h-6 rounded-md bg-red-500/70 hover:bg-red-500/90 text-white transition opacity-0 group-hover:opacity-100"
            >
              <UserMinus size={11} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function SplitHandle({
  rootRef,
  ratio,
  onChange,
}: {
  rootRef: React.RefObject<HTMLDivElement | null>;
  ratio: number;
  onChange: (next: number) => void;
}) {
  const dragRef = useRef<{ pointerId: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    dragRef.current = { pointerId: e.pointerId };
    e.preventDefault();
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const root = rootRef.current;
    if (!root) return;
    const rect = root.getBoundingClientRect();
    if (rect.width <= 0) return;
    const rightFromCursor = rect.right - e.clientX;
    const next = Math.min(
      SPLIT_MAX,
      Math.max(SPLIT_MIN, rightFromCursor / rect.width),
    );
    if (Math.abs(next - ratio) > 0.001) onChange(next);
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    dragRef.current = null;
  };
  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize split"
      className="group h-full cursor-col-resize touch-none flex items-center justify-center"
    >
      <div className="w-[2px] h-12 rounded-full bg-white/15 group-hover:bg-violet-400/70 group-active:bg-violet-400 transition-colors" />
    </div>
  );
}

type MainPick = {
  id: TileId;
  stream: MediaStream;
  muted: boolean;
  mirror?: boolean;
  label: string;
  accent?: string;
};

const cornerClasses: Record<Corner, string> = {
  tl: "top-3 left-3",
  tr: "top-3 right-3",
  bl: "bottom-3 left-3",
  br: "bottom-3 right-3",
};

const cornerLabels: Record<Corner, string> = {
  tl: "Top-left",
  tr: "Top-right",
  bl: "Bottom-left",
  br: "Bottom-right",
};

const WatchPartyViewport = forwardRef<
  WatchPartyViewportHandle,
  {
    localCamStream: MediaStream | null;
    remoteCamStream: MediaStream | null;
    localScreenStream: MediaStream | null;
    remoteScreenStream: MediaStream | null;
    prefs: ViewPrefs;
    onPrefsChange: (next: ViewPrefs) => void;
    pinned: TileId | null;
    onPinChange: (id: TileId | null) => void;
    onFullscreenChange?: (fs: boolean) => void;
    myProfile?: Profile;
    peerProfile?: Profile | null;
    /** Crown / mic-off chip for our own cam tile. */
    localOverlay?: ViewportPeerOverlay;
    /** Crown / mic-off / cam-off / volume / kick for the peer's cam tile. */
    remoteOverlay?: ViewportPeerOverlay;
    // When set, this React node replaces the auto-picked main stream
    // (e.g. the watch-together player). Cams + layout/fullscreen prefs
    // continue to apply unchanged. Pin is suppressed since there's no
    // stream to pin against.
    customMain?: ReactNode;
  }
>(function WatchPartyViewport(
  {
    localCamStream,
    remoteCamStream,
    localScreenStream,
    remoteScreenStream,
    prefs,
    onPrefsChange,
    pinned,
    onPinChange,
    onFullscreenChange,
    myProfile,
    peerProfile,
    localOverlay,
    remoteOverlay,
    customMain,
  },
  externalRef,
) {
  const myName = myProfile?.name?.trim() || "You";
  const peerName = displayName(peerProfile ?? null, "Peer");
  const myColor = myProfile?.color;
  const peerColor = peerProfile?.color;
  const rootRef = useRef<HTMLDivElement>(null);
  const camsRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startDx: number;
    startDy: number;
    moved: boolean;
  } | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // CSS-based "fullscreen" — fills the Tauri window viewport via position:
  // fixed. More reliable than Element.requestFullscreen() across webviews
  // and doesn't require an OS-level fullscreen transition. Esc exits.
  useEffect(() => {
    onFullscreenChange?.(isFullscreen);
    if (!isFullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsFullscreen(false);
    };
    document.addEventListener("keydown", onKey);
    // Lock body scroll so the underlying page can't scroll while the
    // fullscreen overlay is up.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [isFullscreen, onFullscreenChange]);

  useImperativeHandle(
    externalRef,
    () => ({
      isFullscreen,
      toggleFullscreen: () => setIsFullscreen((v) => !v),
    }),
    [isFullscreen],
  );

  // Filter dead streams (no live video tracks) at this boundary so the rest
  // of the layout logic only sees real streams. Prevents a black ghost tile
  // when a remote screen share ends but state cleanup is delayed.
  const safeLocalCam = hasLiveVideo(localCamStream) ? localCamStream : null;
  const safeRemoteCam = hasLiveVideo(remoteCamStream) ? remoteCamStream : null;
  const safeLocalScreen = hasLiveVideo(localScreenStream)
    ? localScreenStream
    : null;
  const safeRemoteScreen = hasLiveVideo(remoteScreenStream)
    ? remoteScreenStream
    : null;

  const streamPresent: Record<TileId, MediaStream | null> = useMemo(
    () => ({
      localCam: safeLocalCam,
      remoteCam: safeRemoteCam,
      localScreen: safeLocalScreen,
      remoteScreen: safeRemoteScreen,
    }),
    [safeLocalCam, safeRemoteCam, safeLocalScreen, safeRemoteScreen],
  );

  // Pick the main viewport stream: pinned (if present) → remote screen →
  // local screen.
  const main: MainPick | null = useMemo(() => {
    const choose = (id: TileId): MainPick | null => {
      const s = streamPresent[id];
      if (!s) return null;
      const isLocal = id === "localCam" || id === "localScreen";
      return {
        id,
        stream: s,
        // Always muted here — remote audio plays through a dedicated
        // <audio> sink in the parent that's immune to layout churn. If
        // these tiles played audio too we'd hear an echo / double track.
        muted: true,
        mirror: id === "localCam",
        label:
          id === "localCam"
            ? myName
            : id === "remoteCam"
              ? peerName
              : isLocal
                ? `${myName} (screen)`
                : `${peerName} (screen)`,
        accent: isLocal ? myColor : peerColor,
      };
    };
    if (pinned) {
      const p = choose(pinned);
      if (p) return p;
    }
    return choose("remoteScreen") ?? choose("localScreen");
  }, [myColor, myName, peerColor, peerName, pinned, streamPresent]);

  // Map a tile id to its overlay descriptor — kept inline so adding
  // future tile types (e.g. third peer) is a one-liner.
  const overlayFor = (id: TileId): ViewportPeerOverlay | undefined => {
    if (id === "localCam") return localOverlay;
    if (id === "remoteCam") return remoteOverlay;
    return undefined;
  };

  // Cam tiles to show in the layout (everything that's NOT the main stream).
  // When `customMain` is used the auto-picked main is irrelevant — we want
  // both cams and any active screen to show alongside the custom panel.
  const camTiles = useMemo(() => {
    const tiles: {
      id: TileId;
      stream: MediaStream;
      label: string;
      accent?: string;
      muted: boolean;
      mirror?: boolean;
    }[] = [];
    const skip = customMain ? undefined : main?.id;
    if (safeRemoteCam && skip !== "remoteCam")
      tiles.push({
        id: "remoteCam",
        stream: safeRemoteCam,
        label: peerName,
        accent: peerColor,
        // Audio sink in the parent handles playback — see CallsPage.
        muted: true,
      });
    if (safeLocalCam && skip !== "localCam")
      tiles.push({
        id: "localCam",
        stream: safeLocalCam,
        label: myName,
        accent: myColor,
        muted: true,
        mirror: true,
      });
    // If a screen exists but isn't the main, also show it as a tile.
    if (safeRemoteScreen && skip !== "remoteScreen")
      tiles.push({
        id: "remoteScreen",
        stream: safeRemoteScreen,
        label: `${peerName} (screen)`,
        accent: peerColor,
        muted: true,
      });
    if (safeLocalScreen && skip !== "localScreen")
      tiles.push({
        id: "localScreen",
        stream: safeLocalScreen,
        label: `${myName} (screen)`,
        accent: myColor,
        muted: true,
      });
    return tiles;
  }, [
    main?.id,
    safeLocalCam,
    safeLocalScreen,
    safeRemoteCam,
    safeRemoteScreen,
    myColor,
    myName,
    peerColor,
    peerName,
    customMain,
  ]);

  const camWidth = CAM_TILE_WIDTHS[prefs.camSize];

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (prefs.layout !== "theater") return;
      const el = camsRef.current;
      if (!el) return;
      el.setPointerCapture(e.pointerId);
      dragStateRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        startDx: prefs.camOffset?.dx ?? 0,
        startDy: prefs.camOffset?.dy ?? 0,
        moved: false,
      };
    },
    [prefs.camOffset, prefs.layout],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const ds = dragStateRef.current;
      if (!ds || ds.pointerId !== e.pointerId) return;
      const dx = ds.startDx + (e.clientX - ds.startX);
      const dy = ds.startDy + (e.clientY - ds.startY);
      if (Math.abs(e.clientX - ds.startX) > 3 || Math.abs(e.clientY - ds.startY) > 3) {
        ds.moved = true;
      }
      onPrefsChange({ ...prefs, camOffset: { dx, dy } });
    },
    [onPrefsChange, prefs],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const ds = dragStateRef.current;
      if (!ds || ds.pointerId !== e.pointerId) return;
      dragStateRef.current = null;
      const cams = camsRef.current;
      const root = rootRef.current;
      if (!cams || !root) return;
      if (!ds.moved) return;
      const camsRect = cams.getBoundingClientRect();
      const rootRect = root.getBoundingClientRect();
      // Distance from each cam-tile corner to each root corner.
      const corners: Array<{ c: Corner; x: number; y: number }> = [
        { c: "tl", x: rootRect.left, y: rootRect.top },
        { c: "tr", x: rootRect.right, y: rootRect.top },
        { c: "bl", x: rootRect.left, y: rootRect.bottom },
        { c: "br", x: rootRect.right, y: rootRect.bottom },
      ];
      const camPts: Array<{ c: Corner; x: number; y: number }> = [
        { c: "tl", x: camsRect.left, y: camsRect.top },
        { c: "tr", x: camsRect.right, y: camsRect.top },
        { c: "bl", x: camsRect.left, y: camsRect.bottom },
        { c: "br", x: camsRect.right, y: camsRect.bottom },
      ];
      let best: { c: Corner; dist: number } | null = null;
      for (const cc of corners) {
        const cp = camPts.find((p) => p.c === cc.c)!;
        const d = Math.hypot(cp.x - cc.x, cp.y - cc.y);
        if (!best || d < best.dist) best = { c: cc.c, dist: d };
      }
      if (best && best.dist < SNAP_RADIUS) {
        onPrefsChange({ ...prefs, camCorner: best.c, camOffset: null });
      }
    },
    [onPrefsChange, prefs],
  );

  if (!main && !customMain) {
    return (
      <div
        ref={rootRef}
        className="aspect-video rounded-xl bg-black/60 border border-white/10 grid place-items-center text-sm text-neutral-500"
      >
        Waiting for a stream…
      </div>
    );
  }

  const fit = prefs.screenFit;
  // Suppress pin buttons when the main slot is a custom panel — pinning
  // would replace the watch-together player with a cam tile, which is
  // never what the user wants in that mode.
  const showPin = !customMain;
  const renderMain = (className: string) => {
    if (customMain) {
      return <div className={className}>{customMain}</div>;
    }
    if (!main) return null;
    return (
      <Tile
        id={main.id}
        stream={main.stream}
        label={main.label}
        accent={main.accent}
        muted={main.muted}
        mirror={main.mirror}
        fit={fit}
        pinned={pinned}
        onPin={onPinChange}
        showPin={showPin}
        className={className}
        overlay={overlayFor(main.id)}
      />
    );
  };

  // Inline styles (rather than Tailwind classes) for the fullscreen
  // overlay: each layout root has `relative` in its base className, which
  // may win over a class-applied `fixed` depending on Tailwind's emit
  // order — inline styles always win the cascade.
  const fsStyle: React.CSSProperties | undefined = isFullscreen
    ? {
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: "100vw",
        height: "100vh",
        zIndex: 9999,
        background: "#000",
        borderRadius: 0,
        aspectRatio: "auto",
        margin: 0,
        padding:
          prefs.layout === "theater" || prefs.layout === "spotlight" ? 0 : 16,
      }
    : undefined;
  const fsClose = isFullscreen ? (
    <button
      type="button"
      onClick={() => setIsFullscreen(false)}
      aria-label="Exit fullscreen"
      style={{ position: "absolute", top: 16, right: 16, zIndex: 10 }}
      className="grid place-items-center w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur text-white"
    >
      ✕
    </button>
  ) : null;

  // Render fullscreen content via a portal to document.body so it escapes
  // the GlassCard's backdrop-filter containing block (otherwise `position:
  // fixed` is trapped inside the card).
  const wrap = (el: ReactElement): ReactElement | null =>
    isFullscreen && typeof document !== "undefined"
      ? (createPortal(el, document.body) as ReactElement | null)
      : el;

  // SPOTLIGHT — just the main, no cams
  if (prefs.layout === "spotlight" || !prefs.camsVisible) {
    return wrap(
      <div
        ref={rootRef}
        style={fsStyle}
        className={
          isFullscreen
            ? "overflow-hidden"
            : "relative aspect-video rounded-xl overflow-hidden bg-black border border-white/10"
        }
      >
        {renderMain("w-full h-full")}
        {fsClose}
      </div>,
    );
  }

  // SIDE-BY-SIDE — main + cams in a right column, splitter is draggable
  if (prefs.layout === "sideBySide") {
    const rightPct = `${(prefs.splitRatio * 100).toFixed(2)}%`;
    return wrap(
      <div
        ref={rootRef}
        style={{
          ...fsStyle,
          display: "grid",
          gridTemplateColumns: `1fr 6px ${rightPct}`,
          gap: 0,
        }}
        className={
          isFullscreen ? "overflow-hidden" : "relative rounded-xl"
        }
      >
        {renderMain("rounded-xl border border-white/10 min-w-0 overflow-hidden")}
        <SplitHandle
          rootRef={rootRef}
          ratio={prefs.splitRatio}
          onChange={(r) => onPrefsChange({ ...prefs, splitRatio: r })}
        />
        <div className="flex flex-col gap-2 min-w-0">
          {camTiles.map((t) => (
            <Tile
              key={t.id}
              id={t.id}
              stream={t.stream}
              label={t.label}
              accent={t.accent}
              muted={t.muted}
              mirror={t.mirror}
              fit={t.id.endsWith("Screen") ? fit : "cover"}
              pinned={pinned}
              onPin={onPinChange}
              showPin={showPin}
              className="aspect-video rounded-lg border border-white/10"
              overlay={overlayFor(t.id)}
            />
          ))}
        </div>
        {fsClose}
      </div>,
    );
  }

  // THEATER — main fills viewport, cams as PiP overlay in selected corner
  const corner = prefs.camCorner;
  const offset = prefs.camOffset;
  const camWrapperStyle: React.CSSProperties = offset
    ? {
        position: "absolute",
        // Anchor at chosen corner first, then shift by offset
        top: corner.startsWith("t") ? 12 : undefined,
        bottom: corner.startsWith("b") ? 12 : undefined,
        left: corner.endsWith("l") ? 12 : undefined,
        right: corner.endsWith("r") ? 12 : undefined,
        transform: `translate(${offset.dx}px, ${offset.dy}px)`,
        width: camWidth,
      }
    : { width: camWidth };

  return wrap(
    <div
      ref={rootRef}
      style={fsStyle}
      className={
        isFullscreen
          ? "overflow-hidden"
          : "relative aspect-video rounded-xl overflow-hidden bg-black border border-white/10"
      }
    >
      {renderMain("w-full h-full")}
      {camTiles.length > 0 && (
        <div
          ref={camsRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          aria-label={`Camera tiles (${cornerLabels[corner]})`}
          className={clsx(
            "absolute flex flex-col gap-2 cursor-grab active:cursor-grabbing touch-none",
            !offset && cornerClasses[corner],
          )}
          style={camWrapperStyle}
        >
          {camTiles.map((t) => (
            <Tile
              key={t.id}
              id={t.id}
              stream={t.stream}
              label={t.label}
              accent={t.accent}
              muted={t.muted}
              mirror={t.mirror}
              fit={t.id.endsWith("Screen") ? fit : "cover"}
              pinned={pinned}
              onPin={onPinChange}
              showPin={showPin}
              className="aspect-video rounded-lg shadow-lg border border-white/10"
              overlay={overlayFor(t.id)}
            />
          ))}
        </div>
      )}
      {fsClose}
    </div>,
  );
});

export default WatchPartyViewport;
