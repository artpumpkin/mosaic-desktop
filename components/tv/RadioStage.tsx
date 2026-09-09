"use client";
import { useState } from "react";
import { Radio as RadioIcon } from "lucide-react";
import clsx from "clsx";
import type { TvChannel } from "@/lib/tv/types";
import RadioVisualizer from "./RadioVisualizer";

type Props = {
  channel: TvChannel;
  countryFlag?: string;
  /** Friendly genre label, e.g. "Classical". Falls back to the raw category. */
  genreLabel?: string | null;
  /** Whether audio is currently playing — drives the visualizer energy. */
  playing: boolean;
  /** Live audio analyser for real spectrum reactivity (null → simulation). */
  analyser?: AnalyserNode | null;
};

// Spectrum chip states. "reactive" = analyser graph built (audio via proxy);
// "ambient" = simulated (proxy down or direct-stream fallback).

// Deterministic hue per station so each gets a distinct, stable palette.
function hueFromId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return h;
}

export default function RadioStage({
  channel,
  countryFlag,
  genreLabel,
  playing,
  analyser,
}: Props) {
  const [logoOk, setLogoOk] = useState(true);
  const hue = hueFromId(channel.id);
  const showLogo = !!channel.logo && logoOk;

  return (
    <div
      className="absolute inset-0 overflow-hidden"
      style={{
        background: `linear-gradient(160deg, hsl(${hue} 55% 8%), hsl(${(hue + 25) % 360} 50% 5%))`,
      }}
    >
      {/* Generative / spectrum visualization fills the stage. */}
      <RadioVisualizer
        accentHue={hue}
        playing={playing}
        analyser={analyser}
        className="absolute inset-0"
      />

      {/* Vignette for depth — darkens the edges so the center pops. */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 35%, rgba(0,0,0,0.55) 100%)",
        }}
      />

      {/* Logo anchored to the EXACT canvas center so it sits dead-center in
          the visualizer ring (not pushed up by the text below it). */}
      <div
        className={clsx(
          "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10",
          "grid place-items-center rounded-full overflow-hidden",
          "w-32 h-32 md:w-40 md:h-40",
          "ring-1 ring-white/15 shadow-2xl",
          playing && "animate-[pulse_3s_ease-in-out_infinite]",
        )}
        style={{
          background: `radial-gradient(circle at 30% 25%, hsl(${hue} 70% 22%), hsl(${(hue + 30) % 360} 60% 8%))`,
          boxShadow: `0 0 60px -10px hsl(${hue} 80% 45% / 0.45)`,
        }}
      >
        {showLogo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={channel.logo as string}
            alt=""
            className="w-full h-full object-cover"
            onError={() => setLogoOk(false)}
          />
        ) : (
          <RadioIcon
            className="text-white/80"
            style={{ width: "42%", height: "42%" }}
            strokeWidth={1.5}
          />
        )}
      </div>

      {/* Name + chips placed BELOW the centered logo (absolute offset so they
          don't shift the logo off-center). */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 translate-y-[5.5rem] md:translate-y-[6.5rem] z-10 flex flex-col items-center text-center gap-1.5 w-[80%] pointer-events-none">
        <h2 className="text-lg md:text-2xl font-semibold text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.6)]">
          {channel.name}
        </h2>
        <div className="flex items-center justify-center flex-wrap gap-2 text-[12px] text-white/70">
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-black/40 backdrop-blur-sm ring-1 ring-white/10">
                <span
                  className={clsx(
                    "w-1.5 h-1.5 rounded-full",
                    playing ? "bg-rose-400" : "bg-neutral-500",
                  )}
                />
                {playing ? "LIVE" : "Paused"}
              </span>
              {countryFlag && (
                <span className="px-2 py-0.5 rounded-full bg-black/40 backdrop-blur-sm ring-1 ring-white/10">
                  {countryFlag} {channel.country}
                </span>
              )}
              {genreLabel && (
                <span className="px-2 py-0.5 rounded-full bg-black/40 backdrop-blur-sm ring-1 ring-white/10 capitalize">
                  {genreLabel}
                </span>
              )}
              <span
                className="px-2 py-0.5 rounded-full bg-black/40 backdrop-blur-sm ring-1 ring-white/10"
                title={
                  analyser
                    ? "Bars react to the live audio spectrum"
                    : "Simulated motion (live audio not tappable for this station)"
                }
              >
                {analyser ? "Reactive" : "Ambient"}
              </span>
            </div>
      </div>
    </div>
  );
}
