"use client";
import { useMemo } from "react";
import { Mic, Rss, Check } from "lucide-react";
import clsx from "clsx";

import AudioDetailModal, { type ModalRow } from "@/components/audio/AudioDetailModal";
import type { PodcastFeed } from "@/lib/podcasts/types";

// The podcast detail modal — a thin adapter over the shared AudioDetailModal.
// Maps the feed + episode rows onto the shared surface and contributes the
// podcast-specific Subscribe button as the header action.
export type ModalEpisode = ModalRow;

type Props = {
  open: boolean;
  /** Poster/title/author known immediately from the chart row (feed loads after). */
  header: { title: string; author: string | null; image: string | null } | null;
  feed: PodcastFeed | null;
  loading: boolean;
  episodes: ModalEpisode[];
  isSubscribed: boolean;
  onToggleSubscribe: () => void;
  onClose: () => void;
};

export default function PodcastFeedModal({
  open,
  header,
  feed,
  loading,
  episodes,
  isSubscribed,
  onToggleSubscribe,
  onClose,
}: Props) {
  const title = feed?.title ?? header?.title ?? "Loading…";
  const author = feed?.author ?? header?.author ?? null;
  const image = feed?.image ?? header?.image ?? null;
  const description = feed?.description ?? null;

  const meta = useMemo(() => {
    const latest = episodes.reduce<number | null>(
      (acc, e) =>
        e.publishedAt && (acc == null || e.publishedAt > acc) ? e.publishedAt : acc,
      null,
    );
    return [
      episodes.length > 0 ? `${episodes.length} episodes` : null,
      latest ? `Latest ${new Date(latest).toLocaleDateString()}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
  }, [episodes]);

  const subscribeButton = (
    <button
      type="button"
      onClick={onToggleSubscribe}
      aria-pressed={isSubscribed}
      className={clsx(
        "inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg border text-[12.5px] font-medium transition active:scale-95",
        isSubscribed
          ? "bg-rose-500 border-rose-400/60 text-white hover:bg-rose-500/80"
          : "bg-white/10 border-white/15 text-white hover:bg-white/20",
      )}
    >
      {isSubscribed ? <Check size={14} strokeWidth={2.5} /> : <Rss size={14} />}
      {isSubscribed ? "Subscribed" : "Subscribe"}
    </button>
  );

  return (
    <AudioDetailModal
      open={open}
      onClose={onClose}
      header={{ title, subtitle: author, image, meta, description }}
      fallbackIcon={<Mic size={28} />}
      action={subscribeButton}
      loading={loading}
      rows={episodes}
      kind="podcast"
      listTitle="Episodes"
      searchPlaceholder="Search episodes…"
      dateSort
      favoritesAlwaysVisible
      viewKey="mosaic.audio.podcast.episodeView"
      resetKey={feed?.feedUrl ?? header?.title ?? null}
    />
  );
}
