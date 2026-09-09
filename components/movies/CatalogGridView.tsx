"use client";
import MediaGridView from "@/components/browse/MediaGridView";
import PosterCard from "./PosterCard";
import type { CatalogItem } from "@/lib/movies/types";

type Props = {
  title: string;
  items: CatalogItem[];
  activeId: string | null;
  favorites: Set<string>;
  onPick: (item: CatalogItem) => void;
  onToggleFavorite: (id: string) => void;
  onBack: () => void;
  // Infinite-scroll plumbing
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
};

/**
 * Movies/Anime "See all" grid — the shared MediaGridView in sticky,
 * infinite-scroll mode wired with PosterCards.
 */
export default function CatalogGridView({
  title,
  items,
  activeId,
  favorites,
  onPick,
  onToggleFavorite,
  onBack,
  hasMore,
  loadingMore,
  onLoadMore,
}: Props) {
  return (
    <MediaGridView
      title={title}
      items={items}
      getKey={(item) => item.id}
      onBack={onBack}
      sticky
      hasMore={hasMore}
      loadingMore={loadingMore}
      onLoadMore={onLoadMore}
      renderItem={(item) => (
        <PosterCard
          item={item}
          active={item.id === activeId}
          isFavorite={favorites.has(item.id)}
          onPick={onPick}
          onToggleFavorite={onToggleFavorite}
          fluid
        />
      )}
    />
  );
}
