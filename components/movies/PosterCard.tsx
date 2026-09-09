"use client";
import MediaCard from "@/components/browse/MediaCard";
import type { CatalogItem } from "@/lib/movies/types";

type Props = {
  item: CatalogItem;
  active?: boolean;
  isFavorite: boolean;
  onPick: (item: CatalogItem) => void;
  onToggleFavorite: (id: string) => void;
  // For "Continue watching" rails — expressed as a 0..1 fraction.
  progress?: number;
  badge?: string; // e.g. "S2 · E3"
  // When true, stretch to the parent column width instead of the fixed 160px
  // rail width (used by the grid view).
  fluid?: boolean;
};

/**
 * Movies/Anime poster card — a thin adapter over the shared MediaCard. Maps the
 * Cinemeta/Kitsu CatalogItem onto the shared card and keeps the (item)-based
 * callback signatures the Movies/Anime pages already pass.
 */
export default function PosterCard({
  item,
  active,
  isFavorite,
  onPick,
  onToggleFavorite,
  progress,
  badge,
  fluid,
}: Props) {
  return (
    <MediaCard
      title={item.name}
      poster={item.poster}
      subtitle={item.releaseInfo ?? item.genres?.slice(0, 2).join(" · ") ?? " "}
      rating={item.imdbRating}
      active={active}
      isFavorite={isFavorite}
      onPick={() => onPick(item)}
      onToggleFavorite={() => onToggleFavorite(item.id)}
      progress={progress}
      badge={badge}
      fluid={fluid}
      accent="rose"
    />
  );
}
