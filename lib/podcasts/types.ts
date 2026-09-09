// Podcast domain types. Feeds are RSS 2.0 (+ the iTunes namespace); discovery
// is the iTunes Search API. Everything is namespaced by the feed URL, which is
// the stable identity of a podcast.

export type PodcastSubscription = {
  feedUrl: string;
  title: string;
  author: string | null;
  image: string | null;
  addedAt: number;
};

export type PodcastEpisode = {
  id: string; // guid, or the enclosure URL as a fallback
  title: string;
  audioUrl: string;
  durationSec: number | null;
  publishedAt: number | null; // epoch ms
  image: string | null;
  description: string | null;
};

export type PodcastFeed = {
  feedUrl: string;
  title: string;
  author: string | null;
  image: string | null;
  description: string | null;
  episodes: PodcastEpisode[];
};

// A single iTunes podcast row — from the Search API or a Top Charts row. Both
// are normalized to always carry a feedUrl: search results without one are
// dropped, and chart rows whose feedUrl can't be resolved via lookup are
// filtered out (an unsubscribable/unopenable show isn't worth surfacing).
export type ItunesPodcast = {
  feedUrl: string;
  title: string;
  author: string | null;
  image: string | null;
};
