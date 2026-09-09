"use client";
import MediaRail from "@/components/browse/MediaRail";
import MangaCard from "./MangaCard";
import { seriesKey, type Manga } from "@/lib/manga/types";

type Props = {
  title: string;
  count?: number;
  items: Manga[];
  activeKey: string | null; // `${sourceId}:${id}` of the open series
  favorites: Set<string>; // set of seriesKeys
  onPick: (item: Manga) => void;
  onToggleFavorite: (item: Manga) => void;
  // Map of seriesKey → progress fraction + badge for the "Continue" rail.
  progressByKey?: Map<string, { fraction: number; badge?: string }>;
  onSeeAll?: () => void;
};

/** Manga rail — the shared MediaRail wired with MangaCards. */
export default function MangaRail({
  title,
  count,
  items,
  activeKey,
  favorites,
  onPick,
  onToggleFavorite,
  progressByKey,
  onSeeAll,
}: Props) {
  return (
    <MediaRail
      title={title}
      count={count}
      items={items}
      getKey={(item) => seriesKey(item.sourceId, item.id)}
      onSeeAll={onSeeAll}
      renderItem={(item) => {
        const key = seriesKey(item.sourceId, item.id);
        const prog = progressByKey?.get(key);
        return (
          <MangaCard
            item={item}
            active={key === activeKey}
            isFavorite={favorites.has(key)}
            onPick={onPick}
            onToggleFavorite={onToggleFavorite}
            progress={prog?.fraction}
            badge={prog?.badge}
          />
        );
      }}
    />
  );
}
