"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { joinRoom, selfId, type Room } from "trystero";
import { toast } from "@/lib/toast";
import type {
  ChatMessage,
  ChatPayload,
  KickPayload,
  PeerStatePayload,
  ProfilePayload,
  StreamCtlPayload,
  StreamMeta,
  WtSource,
  WtSyncPayload,
} from "./types";
import { loadProfile, type Profile } from "./profile";
import {
  isMacSystemAudioSupported,
  startMacSystemAudio,
  type SystemAudioHandle,
} from "./macSystemAudio";

export type CallState = "idle" | "connecting" | "live" | "ended";

const APP_ID = "mosaic-calls-v1";
const MAX_TEXT_LEN = 4096;
const MAX_MESSAGES = 500;

// STUN discovers your public IP through normal NAT; TURN relays media when
// direct P2P fails (symmetric NATs, restrictive firewalls). Open Relay
// Project offers free public TURN — adequate for personal use but
// unauthenticated, so don't ship this to thousands of users. Trystero's
// own "relay failure" warnings come from its Nostr signaling relays
// (separate from these TURN servers) and aren't actionable here.
// Fallback used when personal TURN credentials aren't configured
// (runtime configuration unset) or the credential mint fails. Free public
// relays — adequate but slower/less reliable than Cloudflare's.
const FALLBACK_ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },
  {
    urls: "turn:openrelay.metered.ca:80",
    username: "openrelayproject",
    credential: "openrelayproject",
  },
  {
    urls: "turn:openrelay.metered.ca:443",
    username: "openrelayproject",
    credential: "openrelayproject",
  },
  {
    urls: "turn:openrelay.metered.ca:443?transport=tcp",
    username: "openrelayproject",
    credential: "openrelayproject",
  },
];

type MintedIceServer = {
  urls: string[];
  username?: string;
  credential?: string;
};

// Read the user's runtime ICE configuration through the Tauri command.
// No provider management API key is shipped in the application. Returns null when the command isn't
// available (web build / dev) or credentials aren't configured — caller
// should fall back to FALLBACK_ICE_SERVERS.
async function configuredIceServers(): Promise<RTCIceServer[] | null> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const minted = await invoke<MintedIceServer[]>("mint_turn_credentials");
    if (!Array.isArray(minted) || minted.length === 0) return null;
    return minted.map((s) => ({
      urls: s.urls,
      username: s.username,
      credential: s.credential,
    }));
  } catch {
    return null;
  }
}

const CAMERA_TIMEOUT_MS = 15_000;

async function acquireCamWithTimeout(): Promise<MediaStream> {
  const gum = navigator.mediaDevices.getUserMedia({
    audio: true,
    video: { width: 1280, height: 720 },
  });
  let timer: ReturnType<typeof setTimeout> | null = null;
  let timedOut = false;
  try {
    return await Promise.race([
      gum,
      new Promise<MediaStream>((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          reject(
            new Error(
              "Camera didn't start in 15s. Close any other app or tab using it and try again.",
            ),
          );
        }, CAMERA_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    if (timedOut) {
      // gum may still resolve after the rejection — release the device
      // so it doesn't stay locked.
      gum
        .then((s) => s.getTracks().forEach((t) => t.stop()))
        .catch(() => {});
    }
  }
}

export type CallLog = { ts: number; msg: string };

type SendChat = (payload: ChatPayload) => Promise<void[]>;
type SendProfile = (payload: ProfilePayload) => Promise<void[]>;
type SendStreamCtl = (payload: StreamCtlPayload) => Promise<void[]>;
type SendPeerState = (payload: PeerStatePayload) => Promise<void[]>;
type SendKick = (payload: KickPayload, targetPeer?: string) => Promise<void[]>;
type SendWtSync = (
  payload: WtSyncPayload,
  targetPeer?: string,
) => Promise<void[]>;

/** Live state of the remote peer — mic/cam on/off and host role. */
export type PeerLiveState = {
  micOn: boolean;
  camOn: boolean;
  isHost: boolean;
};

const DEFAULT_PEER_STATE: PeerLiveState = {
  micOn: true,
  camOn: true,
  isHost: false,
};

export type WtSyncOutgoing = {
  op: WtSyncPayload["op"];
  source?: WtSource;
  positionSec?: number;
  playing?: boolean;
};

export type WtSnapshotProvider = () => {
  positionSec: number;
  playing: boolean;
};

export type UseCall = {
  state: CallState;
  roomCode: string | null;
  localCamStream: MediaStream | null;
  localScreenStream: MediaStream | null;
  remoteCamStream: MediaStream | null;
  remoteScreenStream: MediaStream | null;
  isSharingScreen: boolean;
  micOn: boolean;
  camOn: boolean;
  /** True when we created the room (clicked Generate). */
  isHost: boolean;
  iceState: string;
  logs: CallLog[];
  messages: ChatMessage[];
  peerProfile: Profile | null;
  peerState: PeerLiveState;
  watchSource: WtSource | null;
  start: (code: string, opts?: { asHost?: boolean }) => Promise<void>;
  toggleMic: () => void;
  toggleCam: () => void;
  startScreenShare: (options: { includeAudio: boolean }) => Promise<void>;
  stopScreenShare: () => void;
  sendChat: (payload: ChatPayload) => void;
  broadcastProfile: (profile: Profile) => void;
  /** Send a kick request to the peer. Host-only — UI should hide otherwise. */
  kickPeer: (reason?: string) => void;
  sendWtSync: (payload: WtSyncOutgoing) => void;
  subscribeWtSync: (fn: (p: WtSyncPayload) => void) => () => void;
  setWtSnapshotProvider: (fn: WtSnapshotProvider | null) => void;
  hangUp: () => Promise<void>;
};

export function useCall(): UseCall {
  const [state, setState] = useState<CallState>("idle");
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [localCamStream, setLocalCamStream] = useState<MediaStream | null>(null);
  const [localScreenStream, setLocalScreenStream] = useState<MediaStream | null>(null);
  const [remoteCamStream, setRemoteCamStream] = useState<MediaStream | null>(null);
  const [remoteScreenStream, setRemoteScreenStream] = useState<MediaStream | null>(null);
  const [isSharingScreen, setIsSharingScreen] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [isHost, setIsHost] = useState(false);
  const [iceState, setIceState] = useState<string>("new");
  const [logs, setLogs] = useState<CallLog[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [peerProfile, setPeerProfile] = useState<Profile | null>(null);
  const [peerState, setPeerState] = useState<PeerLiveState>(DEFAULT_PEER_STATE);
  const [watchSource, setWatchSource] = useState<WtSource | null>(null);

  const pushLog = useCallback((msg: string) => {
    console.log("[useCall]", msg);
    setLogs((prev) => [...prev.slice(-49), { ts: Date.now(), msg }]);
  }, []);

  const roomRef = useRef<Room | null>(null);
  const camStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const peerIdRef = useRef<string | null>(null);
  const sendChatRef = useRef<SendChat | null>(null);
  const sendProfileRef = useRef<SendProfile | null>(null);
  const sendStreamCtlRef = useRef<SendStreamCtl | null>(null);
  const sendPeerStateRef = useRef<SendPeerState | null>(null);
  const sendKickRef = useRef<SendKick | null>(null);
  const sendWtSyncRef = useRef<SendWtSync | null>(null);
  // Current mic/cam/host snapshot. Keeps the broadcast helper closure-free
  // — `toggleMic`/`toggleCam`/`onPeerJoin` all read the latest value
  // without retriggering the joinRoom effect.
  const localStateRef = useRef<PeerStatePayload>({
    micOn: true,
    camOn: true,
    isHost: false,
  });
  const wtListenersRef = useRef<Set<(p: WtSyncPayload) => void>>(new Set());
  const wtSeqRef = useRef(0);
  const lastSeqByOriginRef = useRef<Record<string, number>>({});
  // Last load/state we've seen — origin-agnostic, used to bring a
  // late-joining peer up to speed on what we're watching.
  const latestWtStateRef = useRef<WtSyncPayload | null>(null);
  const wtSnapshotProviderRef = useRef<WtSnapshotProvider | null>(null);
  const iceListenerRef = useRef<{
    pc: RTCPeerConnection;
    fn: () => void;
  } | null>(null);
  const lastIceLoggedRef = useRef<string | null>(null);
  // Holds the native macOS system-audio capture handle when the current
  // share is augmented with ScreenCaptureKit audio (Tauri on macOS only).
  const macAudioRef = useRef<SystemAudioHandle | null>(null);
  // Bumped by teardown / each fresh start. If an in-flight getUserMedia
  // resolves after the user already hung up or rejoined, we detect the
  // stale epoch and discard the stream instead of setting it onto state
  // that no longer matches reality.
  const startEpochRef = useRef(0);
  // Holds the latest hangUp closure so handlers wired inside the joinRoom
  // effect (kick receiver) can trigger a hangup without depending on the
  // callback at definition time (it's declared further down).
  const hangUpRef = useRef<(() => Promise<void>) | null>(null);

  const teardown = useCallback(async () => {
    // Invalidate any in-flight start() — its getUserMedia might still be
    // pending; we don't want its eventual resolution to revive dead state.
    startEpochRef.current++;
    const room = roomRef.current;
    roomRef.current = null;
    sendChatRef.current = null;
    sendProfileRef.current = null;
    sendStreamCtlRef.current = null;
    sendPeerStateRef.current = null;
    sendKickRef.current = null;
    sendWtSyncRef.current = null;
    wtListenersRef.current.clear();
    latestWtStateRef.current = null;
    lastSeqByOriginRef.current = {};
    wtSeqRef.current = 0;
    wtSnapshotProviderRef.current = null;
    if (iceListenerRef.current) {
      iceListenerRef.current.pc.removeEventListener(
        "iceconnectionstatechange",
        iceListenerRef.current.fn,
      );
      iceListenerRef.current = null;
    }
    lastIceLoggedRef.current = null;
    if (room) {
      try {
        await room.leave();
      } catch {
        // ignore — leave is best-effort
      }
    }
    for (const s of [camStreamRef.current, screenStreamRef.current]) {
      s?.getTracks().forEach((t) => t.stop());
    }
    camStreamRef.current = null;
    screenStreamRef.current = null;
    peerIdRef.current = null;
    setLocalCamStream(null);
    setLocalScreenStream(null);
    setRemoteCamStream(null);
    setRemoteScreenStream(null);
    setIsSharingScreen(false);
    setMicOn(true);
    setCamOn(true);
    setIsHost(false);
    setIceState("new");
    setLogs([]);
    setMessages([]);
    setPeerProfile(null);
    setPeerState(DEFAULT_PEER_STATE);
    setWatchSource(null);
    localStateRef.current = { micOn: true, camOn: true, isHost: false };
  }, []);

  const hangUp = useCallback(async () => {
    await teardown();
    setRoomCode(null);
    setState("idle");
  }, [teardown]);

  useEffect(() => {
    hangUpRef.current = hangUp;
  }, [hangUp]);

  const start = useCallback(
    async (code: string, opts?: { asHost?: boolean }) => {
      const trimmed = code.trim();
      if (!trimmed) return;
      if (roomRef.current) await teardown();

      const epoch = ++startEpochRef.current;
      const asHost = !!opts?.asHost;

      setState("connecting");
      setRoomCode(trimmed);
      setIsHost(asHost);
      localStateRef.current = { micOn: true, camOn: true, isHost: asHost };

      let cam: MediaStream;
      try {
        cam = await acquireCamWithTimeout();
      } catch (e) {
        if (epoch !== startEpochRef.current) return;
        const msg = e instanceof Error ? e.message : "Could not access camera/mic";
        toast("err", msg);
        pushLog(`camera error: ${msg}`);
        setState("idle");
        setRoomCode(null);
        return;
      }
      if (epoch !== startEpochRef.current) {
        // Teardown or a newer start() ran while getUserMedia was pending.
        // Release the camera we just acquired and bail.
        cam.getTracks().forEach((t) => t.stop());
        return;
      }
      camStreamRef.current = cam;
      setLocalCamStream(cam);

      const cfServers = await configuredIceServers();
      if (epoch !== startEpochRef.current) {
        cam.getTracks().forEach((t) => t.stop());
        return;
      }
      const iceServers = cfServers ?? FALLBACK_ICE_SERVERS;
      pushLog(cfServers ? "ice: cloudflare turn" : "ice: openrelay fallback");

      const room = joinRoom(
        {
          appId: APP_ID,
          rtcConfig: { iceServers },
        },
        trimmed,
      );
      roomRef.current = room;

      const camMeta: StreamMeta = { kind: "camera" };

      // Two-step pattern per Trystero docs:
      //   1. addStream(stream)        — sends to peers already in the room
      //   2. onPeerJoin → addStream   — sends to peers who join later
      pushLog(`addStream cam ${cam.getTracks().map((t) => t.kind).join("+")}`);
      room.addStream(cam, undefined, camMeta);

      room.onPeerJoin((peerId) => {
        pushLog(`peer joined ${peerId.slice(0, 6)}`);
        // Only push our streams on a *first-time* join. On reconnect of an
        // already-known peer Trystero renegotiates the existing tracks for
        // us; re-calling addStream creates a duplicate MediaStream on the
        // receiver (manifests as ghost screen tiles after ICE failures).
        const isReconnect = peerIdRef.current === peerId;
        if (!isReconnect) {
          room.addStream(cam, peerId, camMeta);
          if (screenStreamRef.current) {
            const screenMeta: StreamMeta = { kind: "screen" };
            room.addStream(screenStreamRef.current, peerId, screenMeta);
          }
        }
        // Send our profile to the new peer (the initial broadcast above
        // only reaches peers active at start; new joiners need their own).
        const send = sendProfileRef.current;
        if (send) {
          const p = loadProfile();
          if (p.name || p.color) void send(p);
        }
        // Send our live mic/cam/host state so the joiner doesn't render
        // a stale "everything's fine" UI until we next toggle something.
        const sendState = sendPeerStateRef.current;
        if (sendState) void sendState({ ...localStateRef.current });
        // Bring a late-joining peer up to speed on what we're watching.
        // Prefer a fresh snapshot from the player (current position +
        // playing state); fall back to the last known state.
        const sendWt = sendWtSyncRef.current;
        const latest = latestWtStateRef.current;
        if (sendWt && latest && latest.source) {
          const snap = wtSnapshotProviderRef.current?.();
          const payload: WtSyncPayload = {
            origin: selfId,
            seq: ++wtSeqRef.current,
            ts: Date.now(),
            op: "state",
            source: latest.source,
            positionSec: snap ? snap.positionSec : latest.positionSec,
            playing: snap ? snap.playing : latest.playing,
          };
          void sendWt(payload, peerId);
        }
        if (peerIdRef.current && peerIdRef.current !== peerId) return;
        peerIdRef.current = peerId;
        setState("live");
        const peers = room.getPeers();
        const pc = peers[peerId];
        if (pc) {
          setIceState(pc.iceConnectionState);
          // Remove any prior ICE listener (e.g. from a previous join of the
          // same peer after ICE failure) so we don't accumulate handlers.
          if (iceListenerRef.current) {
            iceListenerRef.current.pc.removeEventListener(
              "iceconnectionstatechange",
              iceListenerRef.current.fn,
            );
          }
          const fn = () => {
            const s = pc.iceConnectionState;
            setIceState(s);
            // Coalesce identical consecutive states — keeps the diagnostics
            // panel readable during reconnect storms.
            if (lastIceLoggedRef.current !== s) {
              lastIceLoggedRef.current = s;
              pushLog(`ice ${s}`);
            }
          };
          pc.addEventListener("iceconnectionstatechange", fn);
          iceListenerRef.current = { pc, fn };
        }
      });

      room.onPeerLeave((peerId) => {
        pushLog(`peer left ${peerId.slice(0, 6)}`);
        if (peerIdRef.current !== peerId) return;
        toast("ok", "Peer left — waiting for them to rejoin");
        // Don't tear the room down: we want to stay joined so the other
        // peer can come back (network drop, app restart, browser refresh).
        // Just clear remote state and drop back to "connecting".
        peerIdRef.current = null;
        setRemoteCamStream(null);
        setRemoteScreenStream(null);
        setPeerProfile(null);
        setPeerState(DEFAULT_PEER_STATE);
        setIceState("new");
        lastIceLoggedRef.current = null;
        if (iceListenerRef.current) {
          iceListenerRef.current.pc.removeEventListener(
            "iceconnectionstatechange",
            iceListenerRef.current.fn,
          );
          iceListenerRef.current = null;
        }
        setState("connecting");
      });

      room.onPeerStream((stream, peerId, metadata) => {
        const meta = metadata as StreamMeta | undefined;
        const kind = meta?.kind ?? "camera";
        const tracks = stream.getTracks().map((t) => t.kind).join("+");
        pushLog(`stream from ${peerId.slice(0, 6)} ${kind} (${tracks})`);
        if (peerIdRef.current && peerIdRef.current !== peerId) return;
        peerIdRef.current = peerId;
        if (kind === "screen") {
          setRemoteScreenStream(stream);
          // Detect screen-share stop from peer: when the remote screen's
          // video track ends, clear our state so the layout reverts.
          const v = stream.getVideoTracks()[0];
          v?.addEventListener("ended", () => {
            pushLog(`peer stopped screen share`);
            setRemoteScreenStream(null);
          });
        } else {
          setRemoteCamStream(stream);
        }
      });

      const [sendChatAction, getChatAction] =
        room.makeAction<ChatPayload>("chat");
      sendChatRef.current = sendChatAction;
      getChatAction((data, peerId) => {
        if (peerIdRef.current && peerIdRef.current !== peerId) return;
        const payload = data as ChatPayload;
        setMessages((m) => {
          const next = [
            ...m,
            {
              id: crypto.randomUUID(),
              from: "peer" as const,
              ts: Date.now(),
              ...payload,
            },
          ];
          return next.length > MAX_MESSAGES
            ? next.slice(-MAX_MESSAGES)
            : next;
        });
      });

      const [sendProfileAction, getProfileAction] =
        room.makeAction<ProfilePayload>("profile");
      sendProfileRef.current = sendProfileAction;
      getProfileAction((data, peerId) => {
        if (peerIdRef.current && peerIdRef.current !== peerId) return;
        const p = data as ProfilePayload;
        if (typeof p?.name === "string" && typeof p?.color === "string") {
          setPeerProfile({ name: p.name, color: p.color });
        }
      });

      // Live presence (mic on/off, cam on/off, host role). Decoupled from
      // ProfilePayload because it changes far more frequently — every mic
      // toggle would otherwise force a profile re-render.
      const [sendPeerStateAction, getPeerStateAction] =
        room.makeAction<PeerStatePayload>("peerState");
      sendPeerStateRef.current = sendPeerStateAction;
      getPeerStateAction((data, peerId) => {
        if (peerIdRef.current && peerIdRef.current !== peerId) return;
        const p = data as PeerStatePayload;
        if (
          typeof p?.micOn === "boolean" &&
          typeof p?.camOn === "boolean" &&
          typeof p?.isHost === "boolean"
        ) {
          setPeerState({ micOn: p.micOn, camOn: p.camOn, isHost: p.isHost });
        }
      });

      // Host-initiated kick. We treat any received kick as authoritative —
      // a non-host peer can spoof one, but in a 2-person room the worst
      // they can do is hang up their own peer; the recipient just leaves.
      const [sendKickAction, getKickAction] =
        room.makeAction<KickPayload>("kick");
      sendKickRef.current = sendKickAction;
      getKickAction((data, peerId) => {
        if (peerIdRef.current && peerIdRef.current !== peerId) return;
        const p = data as KickPayload;
        const reason = typeof p?.reason === "string" ? p.reason : null;
        toast(
          "err",
          reason
            ? `You were removed from the call: ${reason}`
            : "You were removed from the call by the host.",
        );
        pushLog(`kicked by peer${reason ? `: ${reason}` : ""}`);
        // Defer so the toast renders before teardown clobbers the page.
        void Promise.resolve().then(() => void hangUpRef.current?.());
      });

      // Side-channel for stream lifecycle events Trystero/WebRTC don't
      // surface reliably. Right now: explicit "I stopped screen sharing"
      // so the receiver can drop its remote screen tile without waiting
      // on a track "ended" event that may never fire after renegotiation.
      const [sendStreamCtlAction, getStreamCtlAction] =
        room.makeAction<StreamCtlPayload>("streamCtl");
      sendStreamCtlRef.current = sendStreamCtlAction;
      getStreamCtlAction((data, peerId) => {
        if (peerIdRef.current && peerIdRef.current !== peerId) return;
        const p = data as StreamCtlPayload;
        if (p?.kind === "screen" && p?.action === "stop") {
          pushLog("peer stopped screen share (signal)");
          setRemoteScreenStream(null);
        }
      });

      // Watch-together control channel: load / play / pause / seek / stop /
      // state (the last is the catch-up snapshot sent to late-joining peers).
      // Receiver drops own-origin echoes and out-of-order seq.
      const [sendWtSyncAction, getWtSyncAction] =
        room.makeAction<WtSyncPayload>("wtSync");
      sendWtSyncRef.current = sendWtSyncAction;
      getWtSyncAction((data, peerId) => {
        if (peerIdRef.current && peerIdRef.current !== peerId) return;
        const p = data as WtSyncPayload;
        if (!p || typeof p.seq !== "number") return;
        if (p.origin === selfId) return;
        const last = lastSeqByOriginRef.current[p.origin] ?? -1;
        if (p.seq <= last) return;
        lastSeqByOriginRef.current[p.origin] = p.seq;
        if (p.op === "stop") {
          latestWtStateRef.current = null;
          setWatchSource(null);
        } else if ((p.op === "load" || p.op === "state") && p.source) {
          latestWtStateRef.current = p;
          setWatchSource(p.source);
        } else if (latestWtStateRef.current) {
          // Keep snapshot fresh so a peer that joins after us can catch up.
          latestWtStateRef.current = {
            ...latestWtStateRef.current,
            positionSec: p.positionSec ?? latestWtStateRef.current.positionSec,
            playing:
              typeof p.playing === "boolean"
                ? p.playing
                : p.op === "play"
                  ? true
                  : p.op === "pause"
                    ? false
                    : latestWtStateRef.current.playing,
          };
        }
        for (const fn of wtListenersRef.current) fn(p);
      });

      // Send our profile to whoever's in the room when we arrive, and again
      // each time a new peer joins (handled in the onPeerJoin block below
      // via the broadcast effect in the caller — see broadcastProfile).
      const profile = loadProfile();
      if (profile.name || profile.color) {
        void sendProfileAction(profile);
      }
      // Broadcast our presence flags too — without this, the first peer
      // in the room would render us with default state (mic+cam on, not
      // host) until our next toggle or until they join us back.
      void sendPeerStateAction({ ...localStateRef.current });
    },
    [pushLog, teardown],
  );

  const toggleMic = useCallback(() => {
    const stream = camStreamRef.current;
    if (!stream) return;
    const next = !micOn;
    stream.getAudioTracks().forEach((t) => (t.enabled = next));
    setMicOn(next);
    localStateRef.current = { ...localStateRef.current, micOn: next };
    void sendPeerStateRef.current?.({ ...localStateRef.current });
  }, [micOn]);

  const toggleCam = useCallback(() => {
    const stream = camStreamRef.current;
    if (!stream) return;
    const next = !camOn;
    stream.getVideoTracks().forEach((t) => (t.enabled = next));
    setCamOn(next);
    localStateRef.current = { ...localStateRef.current, camOn: next };
    void sendPeerStateRef.current?.({ ...localStateRef.current });
  }, [camOn]);

  const kickPeer = useCallback(
    (reason?: string) => {
      if (!localStateRef.current.isHost) return;
      const send = sendKickRef.current;
      const target = peerIdRef.current;
      if (!send || !target) return;
      pushLog(`kicking peer ${target.slice(0, 6)}`);
      // Fire the kick, then tear our side down after the message has been
      // handed off. We don't wait for the peer to actually ack — Trystero
      // sends are best-effort over the data channel.
      void send({ reason }, target).finally(() => {
        void hangUpRef.current?.();
      });
    },
    [pushLog],
  );

  const stopScreenShare = useCallback(() => {
    const room = roomRef.current;
    const screen = screenStreamRef.current;
    if (!room || !screen) return;
    // Signal the peer first so they can drop their tile immediately, even
    // if the track "ended" event doesn't propagate (common after ICE
    // renegotiation).
    void sendStreamCtlRef.current?.({ kind: "screen", action: "stop" });
    try {
      room.removeStream(screen);
    } catch {
      // ignore — peer may have left
    }
    screen.getTracks().forEach((t) => t.stop());
    // Tear down the native macOS audio capture, if it was attached.
    const mac = macAudioRef.current;
    macAudioRef.current = null;
    if (mac) void mac.stop();
    screenStreamRef.current = null;
    setLocalScreenStream(null);
    setIsSharingScreen(false);
    pushLog("stopped screen share");
  }, [pushLog]);

  const startScreenShare = useCallback(
    async ({ includeAudio }: { includeAudio: boolean }) => {
      const room = roomRef.current;
      if (!room) {
        toast("err", "Not in a call");
        return;
      }
      const existing = screenStreamRef.current;
      if (existing) {
        const live = existing
          .getTracks()
          .some((t) => t.readyState === "live");
        if (live) {
          pushLog("startScreenShare ignored — already sharing");
          return;
        }
        // Stale ref left behind by a previous teardown / ended event that
        // ran while the room was already gone. Clear it before continuing
        // so the user isn't permanently blocked from sharing again.
        pushLog("startScreenShare clearing stale screen stream");
        existing.getTracks().forEach((t) => t.stop());
        screenStreamRef.current = null;
        const mac = macAudioRef.current;
        macAudioRef.current = null;
        if (mac) void mac.stop();
        setLocalScreenStream(null);
        setIsSharingScreen(false);
      }
      let display: MediaStream;
      try {
        display = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: includeAudio,
        });
      } catch {
        // User cancelled the picker — silent.
        return;
      }

      // On Tauri/macOS, getDisplayMedia ignores `audio: true` (WebKit
      // limitation). Splice in a native ScreenCaptureKit track so peers
      // hear system audio. Failures here are non-fatal: we degrade to
      // video-only with a log line.
      if (
        includeAudio &&
        display.getAudioTracks().length === 0 &&
        isMacSystemAudioSupported()
      ) {
        try {
          const handle = await startMacSystemAudio();
          macAudioRef.current = handle;
          display.addTrack(handle.track);
        } catch (e) {
          const msg = String(e);
          pushLog(`mac system audio unavailable: ${msg.slice(0, 120)}`);
          // The most common cause is Screen Recording permission being
          // denied or not yet granted. Surface it so the user knows
          // where to fix it; sharing continues with video only.
          toast(
            "err",
            "System audio needs Screen Recording permission — System Settings → Privacy → Screen Recording.",
          );
        }
      }

      const screenMeta: StreamMeta = { kind: "screen" };
      screenStreamRef.current = display;
      setLocalScreenStream(display);
      setIsSharingScreen(true);
      const peer = peerIdRef.current;
      const audioTracks = display.getAudioTracks().length;
      pushLog(
        `started screen share (video${audioTracks > 0 ? "+audio" : ""})`,
      );
      room.addStream(display, peer ?? undefined, screenMeta);

      // Revert when the user clicks the OS "Stop sharing" button.
      const v = display.getVideoTracks()[0];
      v?.addEventListener("ended", () => {
        if (screenStreamRef.current === display) {
          stopScreenShare();
        }
      });
    },
    [pushLog, stopScreenShare],
  );

  const broadcastProfile = useCallback((profile: Profile) => {
    const send = sendProfileRef.current;
    if (!send) return;
    void send(profile);
  }, []);

  const sendWtSync = useCallback((payload: WtSyncOutgoing) => {
    const send = sendWtSyncRef.current;
    const full: WtSyncPayload = {
      origin: selfId,
      seq: ++wtSeqRef.current,
      ts: Date.now(),
      op: payload.op,
      source: payload.source,
      positionSec: payload.positionSec,
      playing: payload.playing,
    };
    // Apply locally first so the UI reacts immediately (load shows the
    // player, stop hides it). Receivers do the same on their end.
    if (full.op === "stop") {
      latestWtStateRef.current = null;
      setWatchSource(null);
    } else if ((full.op === "load" || full.op === "state") && full.source) {
      latestWtStateRef.current = full;
      setWatchSource(full.source);
    } else if (latestWtStateRef.current) {
      latestWtStateRef.current = {
        ...latestWtStateRef.current,
        positionSec: full.positionSec ?? latestWtStateRef.current.positionSec,
        playing:
          typeof full.playing === "boolean"
            ? full.playing
            : full.op === "play"
              ? true
              : full.op === "pause"
                ? false
                : latestWtStateRef.current.playing,
      };
    }
    if (send) void send(full);
  }, []);

  const subscribeWtSync = useCallback(
    (fn: (p: WtSyncPayload) => void) => {
      wtListenersRef.current.add(fn);
      return () => {
        wtListenersRef.current.delete(fn);
      };
    },
    [],
  );

  const setWtSnapshotProvider = useCallback(
    (fn: WtSnapshotProvider | null) => {
      wtSnapshotProviderRef.current = fn;
    },
    [],
  );

  const sendChat = useCallback((payload: ChatPayload) => {
    const send = sendChatRef.current;
    if (!send) return;
    const sanitized: ChatPayload =
      payload.kind === "text"
        ? { kind: "text", text: payload.text.slice(0, MAX_TEXT_LEN) }
        : payload;
    setMessages((m) => {
      const next = [
        ...m,
        {
          id: crypto.randomUUID(),
          from: "me" as const,
          ts: Date.now(),
          ...sanitized,
        },
      ];
      return next.length > MAX_MESSAGES
        ? next.slice(-MAX_MESSAGES)
        : next;
    });
    void send(sanitized);
  }, []);

  useEffect(() => {
    return () => {
      teardown();
    };
  }, [teardown]);

  return {
    state,
    roomCode,
    localCamStream,
    localScreenStream,
    remoteCamStream,
    remoteScreenStream,
    isSharingScreen,
    micOn,
    camOn,
    isHost,
    iceState,
    logs,
    messages,
    peerProfile,
    peerState,
    start,
    toggleMic,
    toggleCam,
    startScreenShare,
    stopScreenShare,
    sendChat,
    broadcastProfile,
    kickPeer,
    watchSource,
    sendWtSync,
    subscribeWtSync,
    setWtSnapshotProvider,
    hangUp,
  };
}
