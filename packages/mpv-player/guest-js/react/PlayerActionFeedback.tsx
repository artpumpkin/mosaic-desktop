"use client";

// YouTube-style transient feedback that appears in the center of
// the video when the user toggles play / pause (via click, keyboard,
// or the bar buttons). A dark circular pill with the action's icon
// pops in, scales up, and fades out over ~600ms.
//
// Source of truth is `mpv.onState` — fires on EVERY pause change
// regardless of how it was triggered (mouse click, keyboard, JS
// command). Skips the very first state event so we don't flash on
// initial mount.

import { useEffect, useRef, useState } from "react";
import { Play, Pause } from "lucide-react";
import { mpv } from "../mpv";

type Feedback = { kind: "play" | "pause"; id: number };

export function PlayerActionFeedback() {
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  // Last seen `paused` value — so we can detect a real CHANGE
  // (not just a re-emission of the same state by mpv).
  const prevPausedRef = useRef<boolean | null>(null);
  // Monotonic id so React re-keys the animation when triggered
  // again before the previous one finished.
  const nextIdRef = useRef(0);

  useEffect(() => {
    return mpv.onState((s) => {
      if (s.paused == null) return;
      const prev = prevPausedRef.current;
      prevPausedRef.current = s.paused;
      // Skip the first event — we only want to animate user toggles,
      // not the initial state read.
      if (prev == null) return;
      if (prev === s.paused) return;

      const id = ++nextIdRef.current;
      setFeedback({ kind: s.paused ? "pause" : "play", id });
      // Self-clear after the animation duration. Guard with id so a
      // newer feedback isn't wiped by an older timer.
      window.setTimeout(() => {
        setFeedback((f) => (f && f.id === id ? null : f));
      }, 600);
    });
  }, []);

  if (!feedback) return null;

  return (
    <div
      key={feedback.id}
      className="absolute inset-0 grid place-items-center pointer-events-none z-30"
    >
      <div className="grid place-items-center w-20 h-20 rounded-full bg-black/70 animate-[player-feedback-pop_600ms_ease-out_forwards]">
        {feedback.kind === "play" ? (
          <Play size={36} className="text-white fill-current ml-1" />
        ) : (
          <Pause size={36} className="text-white fill-current" />
        )}
      </div>
    </div>
  );
}
