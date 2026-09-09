"use client";
import MediaRail from "@/components/browse/MediaRail";
import PosterCard from "./PosterCard";
import type { CatalogItem } from "@/lib/movies/types";

type Props = {
  title: string;
  count?: number;
  items: CatalogItem[];
  activeId: string | null;
  favorites: Set<string>;
  onPick: (item: CatalogItem) => void;
  onToggleFavorite: (id: string) => void;
  // Map of id → progress fraction for the "Continue watching" rail.
  progressById?: Map<string, { fraction: number; badge?: string }>;
  // When set, render a "See all" link that opens the full catalog view.
  onSeeAll?: () => void;
};

/** Movies/Anime poster rail — the shared MediaRail wired with PosterCards. */
export default function PosterRail({
  title,
  count,
  items,
  activeId,
  favorites,
  onPick,
  onToggleFavorite,
  progressById,
  onSeeAll,
}: Props) {
  return (
    <MediaRail
      title={title}
      count={count}
      items={items}
      getKey={(item) => item.id}
      onSeeAll={onSeeAll}
      renderItem={(item) => {
        const prog = progressById?.get(item.id);
        return (
          <PosterCard
            item={item}
            active={item.id === activeId}
            isFavorite={favorites.has(item.id)}
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
