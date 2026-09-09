// Real-time radio spectrum WITHOUT tapping the <audio> element.
//
// WKWebView (Safari) silences `createMediaElementSource` for live streams, so
// reading the spectrum off the playing <audio> element is impossible there.
// Instead we fetch the SAME stream a second time through the localhost CORS
// proxy, decode it in rolling chunks with `decodeAudioData` (which Safari does
// support for MP3/AAC), and schedule the decoded buffers — silently — into an
// AnalyserNode. The element keeps playing audibly on its own; this side
// pipeline exists purely to drive the visualization.
//
// The analysis stream and the audible element both consume the live source at
// 1× from near-"now", so they stay loosely in sync (a ~1–2s visualization lag
// is acceptable and unnoticeable in practice).

export type RadioAnalyserHandle = {
  analyser: AnalyserNode;
  stop: () => void;
};

// ~16 KiB ≈ ~1s at 128 kbps — small enough to keep the viz responsive, large
// enough that each decode yields a usable buffer.
const CHUNK_BYTES = 16 * 1024;
// Keep the analysis playhead this close to "now" so the bars stay roughly in
// sync with what the <audio> element is playing (which sits near the live
// edge). icecast bursts a few seconds of buffer on connect; without this the
// scheduler races several seconds ahead and the viz leads the audio.
// A bit of cushion so an occasional slow/failed decode doesn't starve the
// analyser (which would read as a 1s drop to zero). ~0.8s trades a hair of
// sync for a steady signal.
const TARGET_AHEAD_S = 0.8;
// If we drift further ahead than this, drop the queued backlog and resync to
// the live edge (one brief blip in the viz, then aligned again).
const RESYNC_AHEAD_S = 2.5;

export async function startRadioAnalyser(
  ctx: AudioContext,
  url: string,
  log?: (s: string) => void,
): Promise<RadioAnalyserHandle> {
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.82;
  // Route analyser → muted gain → destination so the analysis pass is
  // inaudible but the graph is "live" and pulls scheduled buffers through.
  const muted = ctx.createGain();
  muted.gain.value = 0;
  analyser.connect(muted);
  muted.connect(ctx.destination);

  const abort = new AbortController();
  const sources = new Set<AudioBufferSourceNode>();
  let cursor = ctx.currentTime + 0.15;
  let stopped = false;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    abort.abort();
    for (const s of sources) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
      s.disconnect();
    }
    sources.clear();
    try {
      analyser.disconnect();
      muted.disconnect();
    } catch {
      /* ignore */
    }
  };

  void (async () => {
    let res: Response;
    try {
      res = await fetch(url, { signal: abort.signal });
    } catch (e) {
      if (!stopped) log?.(`analyser fetch failed: ${e instanceof Error ? e.message : e}`);
      return;
    }
    if (!res.ok || !res.body) {
      log?.(`analyser http ${res.status} (no body)`);
      return;
    }
    const reader = res.body.getReader();
    let acc = new Uint8Array(0);
    let decoded = 0;
    let failed = 0;

    while (!stopped) {
      let chunk: { done: boolean; value?: Uint8Array };
      try {
        chunk = await reader.read();
      } catch {
        break;
      }
      if (chunk.done) break;
      if (chunk.value) {
        const merged = new Uint8Array(acc.length + chunk.value.length);
        merged.set(acc);
        merged.set(chunk.value, acc.length);
        acc = merged;
      }
      if (acc.length < CHUNK_BYTES) continue;

      // Trim leading bytes to the first MPEG/ADTS frame sync so the decoder
      // starts on a frame boundary (0xFFEx = MP3, 0xFFFx = AAC-ADTS).
      let start = 0;
      for (let i = 0; i + 1 < acc.length; i++) {
        if (acc[i] === 0xff && (acc[i + 1] & 0xe0) === 0xe0) {
          start = i;
          break;
        }
      }
      const slice = acc.slice(start);
      acc = new Uint8Array(0);

      let buf: AudioBuffer;
      try {
        // decodeAudioData detaches its input — hand it an isolated copy.
        buf = await ctx.decodeAudioData(slice.buffer);
      } catch (e) {
        failed++;
        if (failed % 8 === 1) {
          log?.(`decodeAudioData failed x${failed}: ${e instanceof Error ? e.message : e}`);
        }
        continue;
      }
      if (stopped) break;

      const now = ctx.currentTime;
      decoded++;
      // Drifted too far ahead (initial burst / fetch faster than realtime) —
      // drop the queued backlog and jump the playhead back to ~live.
      if (cursor > now + RESYNC_AHEAD_S) {
        const was = cursor - now;
        for (const s of sources) {
          try {
            s.stop();
          } catch {
            /* already stopped */
          }
          s.disconnect();
        }
        sources.clear();
        cursor = now + TARGET_AHEAD_S;
        log?.(`analyser resync (was ${was.toFixed(2)}s ahead)`);
      }
      if (cursor < now) cursor = now + TARGET_AHEAD_S;
      const node = ctx.createBufferSource();
      node.buffer = buf;
      node.connect(analyser);
      node.start(cursor);
      cursor += buf.duration;
      sources.add(node);
      node.onended = () => {
        sources.delete(node);
        node.disconnect();
      };

      if (decoded % 6 === 0) {
        log?.(
          `analyser decoded=${decoded} failed=${failed} ahead=${(cursor - now).toFixed(2)}s ch=${buf.numberOfChannels} sr=${buf.sampleRate}`,
        );
      }
    }
    log?.(`analyser stream ended (decoded=${decoded} failed=${failed})`);
  })();

  return { analyser, stop };
}
