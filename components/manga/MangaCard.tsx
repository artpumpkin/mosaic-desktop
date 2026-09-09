"use client";
import { BookOpen, BookText } from "lucide-react";
import MediaCard from "@/components/browse/MediaCard";
import type { Manga } from "@/lib/manga/types";

type Props = {
  item: Manga;
  active?: boolean;
  isFavorite: boolean;
  onPick: (item: Manga) => void;
  onToggleFavorite: (item: Manga) => void;
  // For "Continue reading" rails — 0..1 fraction within the current chapter.
  progress?: number;
  badge?: string; // e.g. "Ch. 1054"
  // Stretch to the parent column width instead of the fixed 160px rail width.
  fluid?: boolean;
};

/**
 * Manga cover card — a thin adapter over the shared MediaCard. Swaps in the
 * book glyphs + violet progress accent, and derives the muted subtitle from the
 * series year/status.
 */
export default function MangaCard({
  item,
  active,
  isFavorite,
  onPick,
  onToggleFavorite,
  progress,
  badge,
  fluid,
}: Props) {
  const subtitle =
    item.year != null
      ? String(item.year)
      : item.status && item.status !== "unknown"
        ? item.status[0].toUpperCase() + item.status.slice(1)
        : " ";
  return (
    <MediaCard
      title={item.title}
      poster={item.cover}
      subtitle={subtitle}
      active={active}
      isFavorite={isFavorite}
      onPick={() => onPick(item)}
      onToggleFavorite={() => onToggleFavorite(item)}
      progress={progress}
      badge={badge}
      fluid={fluid}
      accent="violet"
      favoriteLabel="library favorites"
      fallbackIcon={<BookOpen size={32} />}
      overlayIcon={<BookText size={18} />}
    />
  );
}
