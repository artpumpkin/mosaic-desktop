"use client";
import { BookOpen } from "lucide-react";
import MediaHero from "@/components/browse/MediaHero";
import type { BookItem } from "@/lib/books/types";
import { bookToHeroItem } from "@/lib/books/types";
import type { CatalogItem } from "@/lib/movies/types";

type Props = {
  items: BookItem[];
  onPlay: (item: BookItem) => void;
  onInfo: (item: BookItem) => void;
  favorites: Set<string>;
  onToggleFavorite: (id: string) => void;
};

export default function BookHero({
  items,
  onPlay,
  onInfo,
  favorites,
  onToggleFavorite,
}: Props) {
  const heroItems = items.map(bookToHeroItem);
  const byId = new Map(items.map((b) => [b.id, b]));

  const pick = (cat: CatalogItem) => {
    const b = byId.get(cat.id);
    if (b) return b;
    return {
      id: cat.id,
      title: cat.name,
      authors: [],
      cover: cat.poster,
    } satisfies BookItem;
  };

  return (
    <MediaHero
      items={heroItems}
      onPlay={(c) => onPlay(pick(c))}
      onInfo={(c) => onInfo(pick(c))}
      favorites={favorites}
      onToggleFavorite={onToggleFavorite}
      badgeLabel="Featured"
      primaryLabel="Read"
      primaryIcon={<BookOpen size={16} />}
    />
  );
}
