"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export type AudioItem = {
  id: string;
  title: string;
  subtitle?: string | null;
  src: string;
  art?: string | null;
  kind: "podcast" | "music";
};

type Opts = {
  // Fired on every timeupdate — the caller throttles + persists.
  onProgress?: (item: AudioItem, position: number, duration: number) => void;
  // Resume position (seconds) for an item, applied once metadata loads.
  resumeFor?: (item: AudioItem) => number | undefined;
  // Fired when an item finishes (before auto-advancing the queue).
  onEnded?: (item: AudioItem) => void;
};

// A single <audio> element (created imperatively, no DOM node) driving a queue.
// Audio is a mini-player, not a takeover surface, so it gets its own lightweight
// transport rather than the video VideoStage.
export function useAudioPlayer(opts?: Opts) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const queueRef = useRef<AudioItem[]>([]);
  const idxRef = useRef(-1);
  const currentRef = useRef<AudioItem | null>(null);
  const resumeRef = useRef<number | undefined>(undefined);
  const optsRef = useRef(opts);
  // Keep the latest callbacks reachable from the audio element's listeners
  // without re-subscribing. Updated after commit, not during render.
  useEffect(() => {
    optsRef.current = opts;
  });

  const [current, setCurrent] = useState<AudioItem | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);

  const playIndex = useCallback((i: number) => {
    const item = queueRef.current[i];
    const a = audioRef.current;
    if (!item || !a) return;
    idxRef.current = i;
    currentRef.current = item;
    setCurrent(item);
    setPosition(0);
    setDuration(0);
    resumeRef.current = optsRef.current?.resumeFor?.(item);
    a.src = item.src;
    a.load();
    a.play().catch(() => {});
  }, []);

  useEffect(() => {
    const a = new Audio();
    audioRef.current = a;
    const onTime = () => {
      setPosition(a.currentTime);
      const item = currentRef.current;
      if (item && a.duration) {
        optsRef.current?.onProgress?.(item, a.currentTime, a.duration);
      }
    };
    const onMeta = () => {
      setDuration(a.duration || 0);
      const r = resumeRef.current;
      if (r && r > 0 && r < (a.duration || Infinity)) {
        a.currentTime = r;
      }
      resumeRef.current = undefined;
    };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => {
      const item = currentRef.current;
      if (item) optsRef.current?.onEnded?.(item);
      if (idxRef.current + 1 < queueRef.current.length) {
        playIndex(idxRef.current + 1);
      } else {
        setIsPlaying(false);
      }
    };
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("loadedmetadata", onMeta);
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    a.addEventListener("ended", onEnded);
    return () => {
      a.pause();
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("loadedmetadata", onMeta);
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("ended", onEnded);
      audioRef.current = null;
    };
  }, [playIndex]);

  const play = useCallback(
    (queue: AudioItem[], index: number) => {
      queueRef.current = queue;
      playIndex(index);
    },
    [playIndex],
  );

  const toggle = useCallback(() => {
    const a = audioRef.current;
    if (!a || !currentRef.current) return;
    if (a.paused) a.play().catch(() => {});
    else a.pause();
  }, []);

  const seek = useCallback((t: number) => {
    const a = audioRef.current;
    if (a) a.currentTime = t;
  }, []);

  const playNext = useCallback(() => {
    if (idxRef.current + 1 < queueRef.current.length) playIndex(idxRef.current + 1);
  }, [playIndex]);

  const playPrev = useCallback(() => {
    if (idxRef.current > 0) playIndex(idxRef.current - 1);
  }, [playIndex]);

  return { current, isPlaying, position, duration, play, toggle, seek, playNext, playPrev };
}

export type AudioPlayerApi = ReturnType<typeof useAudioPlayer>;
