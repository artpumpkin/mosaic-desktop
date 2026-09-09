"use client";
import MediaRail from "@/components/browse/MediaRail";
import BookCard from "./BookCard";
import type { BookItem } from "@/lib/books/types";

type Props = {
  title: string;
  count?: number;
  items: BookItem[];
  activeId: string | null;
  favorites: Set<string>;
  onPick: (item: BookItem) => void;
  onToggleFavorite: (id: string) => void;
  progressById?: Map<string, { fraction: number; badge?: string }>;
  onSeeAll?: () => void;
};

export default function BookRail({
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
          <BookCard
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
