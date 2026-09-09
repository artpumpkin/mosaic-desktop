"use client";
import MediaGridView from "@/components/browse/MediaGridView";
import BookCard from "./BookCard";
import type { BookItem } from "@/lib/books/types";

type Props = {
  title: string;
  items: BookItem[];
  activeId: string | null;
  favorites: Set<string>;
  onPick: (item: BookItem) => void;
  onToggleFavorite: (id: string) => void;
  onBack: () => void;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
};

export default function BookGridView({
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
        <BookCard
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
