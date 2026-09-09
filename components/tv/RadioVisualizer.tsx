"use client";
import { useEffect, useRef } from "react";

// p5.js visualization for the radio player. When an AnalyserNode is supplied
// (audio routed through the localhost CORS proxy — see lib/tv/radio.ts +
// src-tauri/src/radio_proxy.rs) the bars track the REAL frequency spectrum and
// the central bloom pulses to the actual bass. When no analyser is available
// (proxy down, or playback fell back to a tainted direct stream) it degrades
// to a Perlin-noise simulation so it still looks alive.

type Props = {
  /** Base hue (0–360) — derived per station so each looks distinct. */
  accentHue: number;
  /** Lively while playing, settles when paused/buffering. */
  playing: boolean;
  /** Live audio analyser, or null to fall back to the simulation. */
  analyser?: AnalyserNode | null;
  className?: string;
};

export default function RadioVisualizer({
  accentHue,
  playing,
  analyser,
  className,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef({ accentHue, playing, analyser: analyser ?? null });

  useEffect(() => {
    stateRef.current.accentHue = accentHue;
    stateRef.current.playing = playing;
    stateRef.current.analyser = analyser ?? null;
  }, [accentHue, playing, analyser]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let removed = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let instance: any = null;
    let ro: ResizeObserver | null = null;

    (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const P5 = (await import("p5")).default as any;
      if (removed) return;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sketch = (p: any) => {
        const BARS = 128;
        const barH = new Float32Array(BARS); // smoothed bar heights (0..1)
        let freq: Uint8Array<ArrayBuffer> | null = null; // analyser scratch buffer
        let energy = 0.15; // overall loudness 0..1
        let bassEnergy = 0; // low-band level 0..1
        let bassEma = 0; // running mean for beat detection
        let beatPulse = 0; // decays after a detected beat
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const particles: any[] = [];

        const sizeOf = () => ({
          w: host.clientWidth || 640,
          h: host.clientHeight || 360,
        });

        const paintBg = (alpha = 1) => {
          const { w, h } = sizeOf();
          const hue = stateRef.current.accentHue;
          p.noStroke();
          // Radial-ish vertical gradient, darker at the edges.
          for (let y = 0; y < h; y += 4) {
            const t = y / h;
            const edge = Math.abs(t - 0.5) * 2; // 0 center → 1 edges
            const b = 9 + (1 - edge) * 6;
            p.fill((hue + 10) % 360, 60, b, alpha);
            p.rect(0, y, w, 4);
          }
        };

        // Pull per-bar levels (0..1) from the analyser, or synthesize them.
        // Returns:
        //   "signal" — real spectrum present (out/energy/bass set)
        //   "hold"   — analyser connected but momentarily silent (decode
        //              underrun); caller should HOLD the bars, not flip to sim
        //   "sim"    — no analyser at all → simulation (out/energy/bass set)
        const readLevels = (out: Float32Array, t: number): "signal" | "hold" | "sim" => {
          const a = stateRef.current.analyser;
          if (a) {
            if (!freq || freq.length !== a.frequencyBinCount) {
              freq = new Uint8Array(a.frequencyBinCount);
            }
            a.getByteFrequencyData(freq);
            // Most musical energy sits in the lower ~3/4 of bins; map those
            // across the ring and skip the near-empty top octave.
            const usable = Math.floor(freq.length * 0.78);
            let sum = 0;
            for (let i = 0; i < BARS; i++) {
              const idx = Math.floor((i / BARS) * usable);
              const v = freq[idx] / 255;
              out[i] = v;
              sum += v;
            }
            if (sum > BARS * 0.02) {
              let bass = 0;
              const bn = Math.max(1, Math.floor(usable * 0.12));
              for (let i = 0; i < bn; i++) bass += freq[i] / 255;
              bassEnergy = bass / bn;
              energy = Math.min(1, (sum / BARS) * 2.2);
              return "signal";
            }
            // Connected but no data this frame — brief underrun. Hold rather
            // than briefly snapping to the noise simulation.
            return "hold";
          }
          // No analyser → simulation.
          for (let i = 0; i < BARS; i++) {
            const n = p.noise(i * 0.08, t * 1.3);
            out[i] = n * 0.7;
          }
          bassEnergy = (Math.sin(t * 3.0) * 0.5 + 0.5) * 0.6;
          energy = 0.55;
          return "sim";
        };

        p.setup = () => {
          const { w, h } = sizeOf();
          p.createCanvas(w, h);
          p.colorMode(p.HSB, 360, 100, 100, 1);
          p.frameRate(60);
          paintBg();
        };

        p.draw = () => {
          const { w, h } = sizeOf();
          const s = stateRef.current;
          const hue = s.accentHue;
          const t = p.frameCount * 0.01;
          const gate = s.playing ? 1 : 0.12;

          // Motion-trail wash over the prior frame.
          paintBg(0.26);

          const levels = new Float32Array(BARS);
          const status = readLevels(levels, t);
          if (status === "hold") {
            // Underrun: gently decay the existing bars (and energy) so a brief
            // gap doesn't collapse or scramble the visualization.
            for (let i = 0; i < BARS; i++) barH[i] *= 0.97;
            energy *= 0.94;
            bassEnergy *= 0.9;
          } else {
            for (let i = 0; i < BARS; i++) {
              const target = levels[i] * gate;
              barH[i] += (target - barH[i]) * 0.32;
            }
          }
          const targetE = energy * gate;
          // (energy is recomputed each frame in readLevels; gate it for paused.)
          const e = targetE;

          // Beat detection on the bass band → pulse + particle burst.
          bassEma += (bassEnergy - bassEma) * 0.08;
          if (
            s.playing &&
            bassEnergy > bassEma * 1.35 &&
            bassEnergy > 0.18 &&
            beatPulse < 0.25
          ) {
            beatPulse = 1;
            const cx = w / 2;
            const cy = h / 2;
            const baseR = Math.min(w, h) * 0.19;
            const burst = 10;
            for (let k = 0; k < burst; k++) {
              const a = p.random(p.TWO_PI);
              const sp = p.random(1.5, 4.5);
              particles.push({
                x: cx + Math.cos(a) * baseR,
                y: cy + Math.sin(a) * baseR,
                vx: Math.cos(a) * sp,
                vy: Math.sin(a) * sp,
                life: 1,
                hue: (hue + p.random(-25, 45) + 360) % 360,
              });
            }
          }
          beatPulse *= 0.92;

          const cx = w / 2;
          const cy = h / 2;
          const baseR = Math.min(w, h) * 0.19;
          const amp = Math.min(w, h) * 0.2;
          const bassScale = 1 + bassEnergy * 0.22 * gate + beatPulse * 0.08;

          p.push();
          // Additive-style blending for glow.
          p.blendMode(p.ADD);

          // Soft concentric halo rings, scaled by bass.
          p.noFill();
          for (let r = 0; r < 4; r++) {
            const rr = (baseR + 10 + r * 18) * bassScale;
            p.stroke(hue, 55, 80, (0.06 + 0.05 * e) * (1 - r * 0.18));
            p.strokeWeight(2);
            p.circle(cx, cy, rr * 2);
          }

          // Radial spectrum bars + mirrored inner reflection.
          p.push();
          p.translate(cx, cy);
          p.rotate(t * 0.18 + beatPulse * 0.04);
          for (let i = 0; i < BARS; i++) {
            const a = (i / BARS) * p.TWO_PI;
            const v = barH[i];
            const len = (6 + v * amp) * bassScale;
            const r0 = baseR;
            const r1 = baseR + len;
            const hh = (hue + i * (300 / BARS) + v * 30) % 360;
            const ca = Math.cos(a);
            const sa = Math.sin(a);

            // Outward bar.
            p.stroke(hh, 75, 95, 0.5 + 0.45 * v);
            p.strokeWeight(2.2 + v * 1.6);
            p.line(ca * r0, sa * r0, ca * r1, sa * r1);
            // Bright tip.
            p.stroke(hh, 30, 100, 0.5 * v + 0.2);
            p.strokeWeight(2.2 + v * 1.6);
            p.point(ca * r1, sa * r1);

            // Inner reflection (shorter, dimmer, pointing inward).
            const ri = baseR - 4 - len * 0.42;
            p.stroke(hh, 70, 70, 0.18 + 0.22 * v);
            p.strokeWeight(1.6);
            p.line(ca * (baseR - 4), sa * (baseR - 4), ca * ri, sa * ri);
          }
          p.pop();

          // Central core glow.
          const coreR = baseR * (0.72 + beatPulse * 0.12) * bassScale;
          for (let g = 4; g >= 1; g--) {
            p.noStroke();
            p.fill(hue, 45, 95, 0.05 + 0.05 * e);
            p.circle(cx, cy, coreR * 2 * (g / 4));
          }

          // Beat particles.
          for (let i = particles.length - 1; i >= 0; i--) {
            const pt = particles[i];
            pt.x += pt.vx;
            pt.y += pt.vy;
            pt.vx *= 0.96;
            pt.vy *= 0.96;
            pt.life -= 0.02;
            if (pt.life <= 0) {
              particles.splice(i, 1);
              continue;
            }
            p.noStroke();
            p.fill(pt.hue, 60, 100, pt.life * 0.5);
            p.circle(pt.x, pt.y, pt.life * 4 + 1);
          }
          // Hard cap so a long beaty track never grows the array unbounded.
          if (particles.length > 220) particles.splice(0, particles.length - 220);

          p.pop(); // restore blendMode
        };

        p.windowResized = () => {
          const { w, h } = sizeOf();
          p.resizeCanvas(w, h);
          paintBg();
        };
      };

      instance = new P5(sketch, host);
      ro = new ResizeObserver(() => {
        if (instance?.windowResized) instance.windowResized();
      });
      ro.observe(host);
    })();

    return () => {
      removed = true;
      ro?.disconnect();
      instance?.remove?.();
    };
  }, []);

  return <div ref={hostRef} className={className} aria-hidden />;
}
