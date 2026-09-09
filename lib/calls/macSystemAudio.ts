// macOS system-audio bridge for screen-share.
//
// Tauri uses WKWebView on macOS where `getDisplayMedia({audio:true})` is
// video-only (Apple does not expose system audio through WebKit). On
// macOS we tap ScreenCaptureKit from the Rust side (see
// `src-tauri/src/macos_audio.rs`) and stream the PCM here, where we
// rebuild it into a MediaStreamTrack that can be added alongside the
// display-media video track and shipped through the existing WebRTC
// peer connection.

import { Channel, invoke } from "@tauri-apps/api/core";

type Tauri = { __TAURI_INTERNALS__?: unknown };

/** True iff we're running inside Tauri on macOS — the only platform
 *  where the native fallback is needed AND available. */
export function isMacSystemAudioSupported(): boolean {
  if (typeof window === "undefined") return false;
  if (!(window as unknown as Tauri).__TAURI_INTERNALS__) return false;
  // navigator.platform is deprecated but still reliable in WKWebView; UA
  // sniffing as a fallback. We're allowed to be a bit loose here — the
  // worst case of a false positive is a clean error from the Rust side.
  const p = navigator.platform || "";
  const ua = navigator.userAgent || "";
  return /Mac|iPhone|iPad/i.test(p) || /Mac OS X/i.test(ua);
}

export type SystemAudioHandle = {
  track: MediaStreamTrack;
  stop: () => Promise<void>;
};

/**
 * Start capturing macOS system audio via ScreenCaptureKit and expose it
 * as a regular MediaStreamTrack. The first call triggers the macOS
 * Screen Recording permission prompt; subsequent calls are silent.
 *
 * Throws if the platform isn't supported or the user denies permission.
 * Caller is responsible for calling `stop()` when the share ends.
 */
export async function startMacSystemAudio(): Promise<SystemAudioHandle> {
  if (!isMacSystemAudioSupported()) {
    throw new Error("system audio capture not supported on this platform");
  }

  // 48 kHz matches what we ask ScreenCaptureKit for in Rust. Sticking to
  // the source rate avoids implicit resampling and the latency it adds.
  const ctx = new AudioContext({ sampleRate: 48000, latencyHint: "interactive" });
  if (ctx.sampleRate !== 48000) {
    // WebKit honored a different rate. SCK gives us 48k samples and the
    // graph runs at ctx.sampleRate, so we'd play pitch-shifted. Bail
    // rather than ship glitched audio — caller falls back to video-only.
    try { await ctx.close(); } catch { /* noop */ }
    throw new Error(
      `AudioContext rate is ${ctx.sampleRate}, expected 48000`,
    );
  }
  // WKWebView returns AudioContext in a "suspended" state on macOS until
  // a user gesture; the share-screen button click counts.
  if (ctx.state === "suspended") {
    try { await ctx.resume(); } catch { /* best effort */ }
  }

  await ctx.audioWorklet.addModule("/audio-worklets/system-audio.js");

  const node = new AudioWorkletNode(ctx, "system-audio-processor", {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [2],
  });
  const dest = ctx.createMediaStreamDestination();
  node.connect(dest);

  // Tauri IPC channel: PCM chunks (Vec<f32>, interleaved stereo) stream
  // straight from the SCK output handler thread into JS. Serde converts
  // to a JS number[] which we cast to Float32Array per chunk; the cost
  // is acceptable at our throughput (~100 chunks/s of ~960 floats).
  const channel = new Channel<number[]>();
  channel.onmessage = (chunk) => {
    if (!chunk || chunk.length === 0) return;
    const f32 = new Float32Array(chunk);
    // Transferring the buffer hands it to the worklet without a copy,
    // so we don't accumulate GC pressure at 100 msgs/s.
    node.port.postMessage(f32, [f32.buffer]);
  };

  try {
    await invoke("start_macos_system_audio", { channel });
  } catch (e) {
    // Tear down what we started before bubbling the error so we don't
    // leak the AudioContext / worklet on permission denial.
    try { node.disconnect(); } catch { /* noop */ }
    try { await ctx.close(); } catch { /* noop */ }
    throw new Error(`start_macos_system_audio failed: ${String(e)}`);
  }

  const track = dest.stream.getAudioTracks()[0];
  if (!track) {
    try { await ctx.close(); } catch { /* noop */ }
    throw new Error("no audio track produced by AudioWorklet");
  }

  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    try { await invoke("stop_macos_system_audio"); } catch { /* noop */ }
    try { node.disconnect(); } catch { /* noop */ }
    try { track.stop(); } catch { /* noop */ }
    try { await ctx.close(); } catch { /* noop */ }
  };

  return { track, stop };
}
