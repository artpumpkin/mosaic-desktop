"use client";
import MediaGridView from "@/components/browse/MediaGridView";
import MangaCard from "./MangaCard";
import { seriesKey, type Manga } from "@/lib/manga/types";

type Props = {
  title: string;
  items: Manga[];
  activeKey: string | null;
  favorites: Set<string>;
  onPick: (item: Manga) => void;
  onToggleFavorite: (item: Manga) => void;
  onBack?: () => void;
  loading?: boolean;
};

/** Manga browse/search grid — the shared MediaGridView wired with MangaCards. */
export default function MangaGridView({
  title,
  items,
  activeKey,
  favorites,
  onPick,
  onToggleFavorite,
  onBack,
  loading,
}: Props) {
  return (
    <MediaGridView
      title={title}
      items={items}
      getKey={(item) => seriesKey(item.sourceId, item.id)}
      onBack={onBack}
      loading={loading}
      minColWidth={140}
      renderItem={(item) => {
        const key = seriesKey(item.sourceId, item.id);
        return (
          <MangaCard
            item={item}
            fluid
            active={key === activeKey}
            isFavorite={favorites.has(key)}
            onPick={onPick}
            onToggleFavorite={onToggleFavorite}
          />
        );
      }}
    />
  );
}
