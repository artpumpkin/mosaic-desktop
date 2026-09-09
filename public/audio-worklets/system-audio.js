// AudioWorklet that turns interleaved-stereo Float32 PCM chunks (posted
// from the main thread) into the contiguous audio stream feeding a
// MediaStreamAudioDestinationNode. Used by the macOS system-audio
// bridge: PCM arrives over a Tauri IPC channel from a Rust
// ScreenCaptureKit capture, the main thread postMessage()'s each chunk
// to this worklet, and we drain it into the audio graph one render
// quantum at a time.
//
// Buffer strategy: a single ring buffer per channel sized for ~1s at
// 48 kHz. On underflow we output silence (better than stalling the
// graph and starving downstream consumers like a WebRTC sender). On
// overflow we drop the oldest samples, which lets the stream recover
// when the consumer briefly stalls (e.g. tab background).

const RING_FRAMES = 48000; // 1 second @ 48 kHz per channel

class SystemAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ringL = new Float32Array(RING_FRAMES);
    this.ringR = new Float32Array(RING_FRAMES);
    this.writeIdx = 0;
    this.readIdx = 0;
    // Frames currently buffered (single-producer single-consumer; no
    // atomics needed because both read/write happen on the audio thread:
    // postMessage handlers run on the audio worklet thread in WebKit.)
    this.available = 0;
    this.underflowCount = 0;
    this.overflowCount = 0;
    this.port.onmessage = (e) => this.onChunk(e.data);
  }

  onChunk(interleaved) {
    if (!(interleaved instanceof Float32Array) || interleaved.length < 2) return;
    const frames = interleaved.length >> 1; // /2 (stereo)
    // If we'd overflow, drop the oldest samples by advancing readIdx.
    const room = RING_FRAMES - this.available;
    if (frames > room) {
      const drop = frames - room;
      this.readIdx = (this.readIdx + drop) % RING_FRAMES;
      this.available -= drop;
      this.overflowCount += drop;
    }
    for (let i = 0; i < frames; i++) {
      this.ringL[this.writeIdx] = interleaved[i * 2];
      this.ringR[this.writeIdx] = interleaved[i * 2 + 1];
      this.writeIdx = (this.writeIdx + 1) % RING_FRAMES;
    }
    this.available += frames;
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    const outL = output[0];
    const outR = output[1] ?? output[0]; // mono fallback
    const need = outL.length;
    for (let i = 0; i < need; i++) {
      if (this.available > 0) {
        outL[i] = this.ringL[this.readIdx];
        if (outR !== outL) outR[i] = this.ringR[this.readIdx];
        this.readIdx = (this.readIdx + 1) % RING_FRAMES;
        this.available -= 1;
      } else {
        outL[i] = 0;
        if (outR !== outL) outR[i] = 0;
        this.underflowCount += 1;
      }
    }
    return true;
  }
}

registerProcessor("system-audio-processor", SystemAudioProcessor);
