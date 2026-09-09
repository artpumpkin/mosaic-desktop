export type StreamKind = "camera" | "screen";

export type ChatPayload =
  | { kind: "text"; text: string }
  | { kind: "gif"; gifUrl: string };

export type ChatMessage = ChatPayload & {
  id: string;
  from: "me" | "peer";
  ts: number;
};

export type StreamMeta = { kind: StreamKind };

export type StreamCtlPayload = { kind: "screen"; action: "stop" };

/** What we send/receive over Trystero's "profile" action. */
export type ProfilePayload = {
  name: string;
  color: string;
};

/**
 * Live presence flags broadcast over the "peerState" action. Kept separate
 * from ProfilePayload because it changes much more often (every mic/cam
 * toggle) and we don't want to thrash profile rendering for it.
 */
export type PeerStatePayload = {
  micOn: boolean;
  camOn: boolean;
  /** True for the peer who created the room (clicked Generate). */
  isHost: boolean;
};

/** Sent by the host to ask the peer to leave the room. */
export type KickPayload = {
  /** Optional human-readable reason shown in the kicked peer's toast. */
  reason?: string;
};

export type WtSource =
  | { kind: "youtube"; videoId: string }
  | { kind: "url"; url: string; isHls: boolean };

// Single envelope across the "wtSync" action so the receiver is one switch
// instead of N filtered channels. `origin` lets receivers drop their own
// echoes; `seq` is monotonic per origin and drops out-of-order deliveries.
export type WtSyncPayload = {
  origin: string;
  seq: number;
  ts: number;
  op: "load" | "play" | "pause" | "seek" | "stop" | "state";
  source?: WtSource;
  positionSec?: number;
  playing?: boolean;
};
