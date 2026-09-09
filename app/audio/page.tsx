"use client";
import { useEffect, useRef, useState } from "react";
import { Mic, Music2, Library } from "lucide-react";

import { SegmentedTabs } from "@/components/browse";
import { useWide } from "@/lib/appLayout";
import NowPlayingBar from "@/components/audio/NowPlayingBar";
import { useAudioPlayer } from "@/components/audio/useAudioPlayer";
import PodcastsTab from "@/components/audio/PodcastsTab";
import MusicTab from "@/components/audio/MusicTab";
import LibraryTab from "@/components/audio/LibraryTab";
import {
  getEpisodeProgress,
  saveEpisodeProgress,
  throttledEpisodeSaver,
} from "@/lib/podcasts/library";
import { saveAudioProgress, throttledAudioSaver } from "@/lib/audio/progress";

type Tab = "podcasts" | "music" | "library";
const TAB_KEY = "mosaic.audio.tab";

// The Audio hub: a single page that hosts three browse surfaces — Podcasts
// (iTunes charts + search + subscribe), Music (Audius streaming) and Library
// (local folder). One audio player is shared across all three so playback
// survives tab switches; each tab owns its own toolbar + content.
export default function AudioPage() {
  const [tab, setTab] = useState<Tab>("podcasts");
  // Fill the pane edge-to-edge beside the sidebar (Apple-style), no max-w cap.
  useWide(true);

  // Throttled savers (timeupdate fires ~4×/s). Both stamp their own timestamps
  // inside the lib so the component never calls an impure fn during render.
  const podcastSaver = useRef(throttledEpisodeSaver(5000));
  const audioSaver = useRef(throttledAudioSaver(5000));

  const player = useAudioPlayer({
    resumeFor: (item) =>
      item.kind === "podcast" ? getEpisodeProgress(item.id)?.position : undefined,
    onProgress: (item, pos, dur) => {
      if (item.kind === "podcast") podcastSaver.current(item.id, pos, dur);
      audioSaver.current({
        key: item.id,
        kind: item.kind,
        title: item.title,
        artist: item.subtitle ?? null,
        cover: item.art ?? null,
        position: pos,
        duration: dur,
      });
    },
    onEnded: (item) => {
      // Persist a near-complete position so finished items drop from resume.
      if (item.kind === "podcast" && player.duration) {
        saveEpisodeProgress(item.id, player.duration, player.duration);
      }
      saveAudioProgress({
        key: item.id,
        kind: item.kind,
        title: item.title,
        artist: item.subtitle ?? null,
        cover: item.art ?? null,
        position: player.duration,
        duration: player.duration,
      });
    },
  });

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- hydrate persisted tab post-mount */
    try {
      const t = localStorage.getItem(TAB_KEY) as Tab | null;
      if (t === "podcasts" || t === "music" || t === "library") setTab(t);
    } catch {
      /* ignore */
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const changeTab = (t: Tab) => {
    setTab(t);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      /* ignore */
    }
  };

  const selector = (
    <SegmentedTabs
      value={tab}
      onChange={changeTab}
      tabs={[
        { value: "podcasts", label: "Podcasts", icon: <Mic size={13} /> },
        { value: "music", label: "Music", icon: <Music2 size={13} /> },
        { value: "library", label: "Library", icon: <Library size={13} /> },
      ]}
    />
  );

  // Now-playing transport — pinned to the TOP of the audio section (Apple
  // Podcasts style) via BrowseShell's `header` slot, so it stays fixed while
  // content scrolls. Shared across all three tabs since the player is shared.
  const playerBar = (
    <NowPlayingBar
      current={player.current}
      isPlaying={player.isPlaying}
      position={player.position}
      duration={player.duration}
      onToggle={player.toggle}
      onSeek={player.seek}
      onNext={player.playNext}
      onPrev={player.playPrev}
    />
  );

  if (tab === "music")
    return <MusicTab player={player} selector={selector} playerBar={playerBar} />;
  if (tab === "library")
    return <LibraryTab player={player} selector={selector} playerBar={playerBar} />;
  return <PodcastsTab player={player} selector={selector} playerBar={playerBar} />;
}
