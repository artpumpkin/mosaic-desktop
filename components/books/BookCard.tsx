"use client";
import { BookOpen } from "lucide-react";
import MediaCard from "@/components/browse/MediaCard";
import type { BookItem } from "@/lib/books/types";

type Props = {
  item: BookItem;
  active?: boolean;
  isFavorite: boolean;
  onPick: (item: BookItem) => void;
  onToggleFavorite: (id: string) => void;
  progress?: number;
  badge?: string;
  fluid?: boolean;
};

export default function BookCard({
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
    [item.authors.slice(0, 2).join(", "), item.year].filter(Boolean).join(" · ") ||
    " ";

  return (
    <MediaCard
      title={item.title}
      poster={item.cover}
      subtitle={subtitle}
      rating={item.rating}
      active={active}
      isFavorite={isFavorite}
      onPick={() => onPick(item)}
      onToggleFavorite={() => onToggleFavorite(item.id)}
      progress={progress}
      badge={badge}
      fluid={fluid}
      accent="violet"
      favoriteLabel="favorites"
      overlayIcon={<BookOpen size={18} fill="none" />}
      fallbackIcon={<BookOpen size={28} />}
    />
  );
}
