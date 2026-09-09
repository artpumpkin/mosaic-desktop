"use client";
import {
  BookOpen,
  Heart,
  Calendar,
  Tag,
  Star,
  Loader2,
  Link2,
  FolderOpen,
} from "lucide-react";
import clsx from "clsx";
import type { BookItem, BookMeta, LocalBookEntry } from "@/lib/books/types";
import type { LibgenQuery } from "@/lib/books/libgen";
import BookSourceList from "./BookSourceList";

type Props = {
  item: BookItem;
  meta: BookMeta | null;
  metaLoading: boolean;
  localPath: string | null;
  localLabel?: string | null;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  onRead: () => void;
  onLinkEpub: () => void;
  onImportEpub: () => void;
  /** Libgen lookup for the inline download column (right rail). */
  sourceQuery: LibgenQuery | null;
  workId?: string | null;
  onImported: (entry: LocalBookEntry, isEpub: boolean) => void;
  readDisabled?: boolean;
  progressFraction?: number | null;
};

export default function BookDetail({
  item,
  meta,
  metaLoading,
  localPath,
  localLabel,
  isFavorite,
  onToggleFavorite,
  onRead,
  onLinkEpub,
  onImportEpub,
  sourceQuery,
  workId,
  onImported,
  readDisabled,
  progressFraction,
}: Props) {
  const title = meta?.title ?? item.title;
  const authors = meta?.authors?.length ? meta.authors : item.authors;
  const cover = meta?.cover ?? item.cover;
  const description = meta?.description ?? item.description;
  const year = meta?.year ?? item.year;
  const genres = meta?.genres ?? item.genres ?? meta?.subjects;

  return (
    <div className="relative rounded-2xl overflow-hidden bg-neutral-950/80 ring-1 ring-white/10 shadow-2xl shadow-black/60 flex flex-col h-full">
      <div className="relative h-[280px] md:h-[340px] bg-neutral-950 overflow-hidden shrink-0">
        {cover && (
          <img
            src={cover}
            alt=""
            className="absolute inset-0 w-full h-full object-cover object-center opacity-40 scale-[1.03] blur-sm"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/55 to-black/10" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/75 via-black/10 to-transparent" />
        <div className="relative h-full px-5 md:px-7 pb-5 md:pb-6 flex items-end gap-5">
          {cover && (
            <img
              src={cover}
              alt={title}
              className="hidden md:block w-[124px] aspect-[2/3] object-cover rounded-xl ring-1 ring-white/15 shadow-2xl shadow-black/70"
            />
          )}
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl md:text-[28px] font-semibold tracking-tight text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.6)] leading-tight">
              {title}
            </h1>
            {authors.length > 0 && (
              <p className="mt-1 text-[13px] text-neutral-300">{authors.join(", ")}</p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[12px] text-neutral-300">
              {year && (
                <span className="inline-flex items-center gap-1">
                  <Calendar size={12} />
                  {year}
                </span>
              )}
              {item.rating && (
                <span className="inline-flex items-center gap-1 text-amber-200/90">
                  <Star size={12} className="fill-amber-300/80 text-amber-300/80" />
                  {item.rating}
                </span>
              )}
              {meta?.pageCount && (
                <span className="inline-flex items-center gap-1">
                  <BookOpen size={12} />
                  {meta.pageCount} pages
                </span>
              )}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onRead}
                disabled={readDisabled || !localPath}
                className={clsx(
                  "inline-flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-medium transition-colors",
                  localPath && !readDisabled
                    ? "bg-sky-500 hover:bg-sky-400 text-white shadow-lg shadow-sky-500/25"
                    : "bg-white/10 text-neutral-500 cursor-not-allowed",
                )}
              >
                <BookOpen size={15} />
                {progressFraction && progressFraction > 0.02
                  ? "Continue reading"
                  : "Read"}
              </button>
              <button
                type="button"
                onClick={onToggleFavorite}
                className={clsx(
                  "inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border text-[12.5px] transition-colors",
                  isFavorite
                    ? "border-rose-400/40 bg-rose-500/15 text-rose-200"
                    : "border-white/10 bg-white/5 text-neutral-300 hover:bg-white/10",
                )}
              >
                <Heart size={14} className={isFavorite ? "fill-current" : ""} />
                {isFavorite ? "Saved" : "Save"}
              </button>
              {!localPath && (
                <>
                  <button
                    type="button"
                    onClick={onLinkEpub}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-white/10 bg-white/5 text-[12.5px] text-neutral-300 hover:bg-white/10"
                  >
                    <Link2 size={14} />
                    Link EPUB
                  </button>
                  <button
                    type="button"
                    onClick={onImportEpub}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-white/10 bg-white/5 text-[12.5px] text-neutral-300 hover:bg-white/10"
                  >
                    <FolderOpen size={14} />
                    Import file
                  </button>
                </>
              )}
            </div>
            {localPath && (
              <p className="mt-2 text-[11px] text-emerald-300/80 truncate max-w-lg">
                Linked: {localLabel ?? localPath.split("/").pop()}
              </p>
            )}
            {progressFraction != null && progressFraction > 0 && (
              <div className="mt-3 max-w-xs">
                <div className="h-1 rounded-full bg-white/10 overflow-hidden">
                  <div
                    className="h-full bg-sky-400 rounded-full"
                    style={{ width: `${Math.round(progressFraction * 100)}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="p-4 md:p-5 grid gap-5 md:grid-cols-[1fr_minmax(280px,360px)] flex-1 min-h-0">
        {/* Left: synopsis + genres + ISBN */}
        <div className="space-y-4 min-w-0 overflow-y-auto pr-1">
          {metaLoading ? (
            <div className="flex items-center gap-2 text-neutral-400 text-sm">
              <Loader2 size={16} className="animate-spin" />
              Loading details…
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <div className="text-[10.5px] font-medium uppercase tracking-[0.16em] text-neutral-500">
                  Overview
                </div>
                {description ? (
                  <p className="text-[13.5px] leading-relaxed text-neutral-300/90 whitespace-pre-line max-w-prose">
                    {description}
                  </p>
                ) : (
                  <p className="text-[13px] text-neutral-500">
                    No description available.
                  </p>
                )}
              </div>
              {genres && genres.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {genres.slice(0, 8).map((g) => (
                    <span
                      key={g}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-[11px] text-neutral-300"
                    >
                      <Tag size={10} />
                      {g}
                    </span>
                  ))}
                </div>
              )}
              {meta?.isbns && meta.isbns.length > 0 && (
                <p className="text-[11px] text-neutral-500">
                  ISBN: {meta.isbns.slice(0, 3).join(", ")}
                </p>
              )}
            </>
          )}
        </div>

        {/* Right: download links — Books' answer to the streams column. */}
        <BookSourceList
          query={sourceQuery}
          workId={workId}
          onImported={onImported}
        />
      </div>
    </div>
  );
}
