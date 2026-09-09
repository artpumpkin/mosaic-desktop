"use client";
import { useMemo, useState } from "react";
import {
  BookOpen,
  Heart,
  Loader2,
  Plus,
  Check,
  Play,
  ArrowDownUp,
} from "lucide-react";
import clsx from "clsx";
import type { Manga, MangaDetail as MangaDetailT, Chapter } from "@/lib/manga/types";

type Props = {
  item: Manga;
  detail: MangaDetailT | null;
  detailLoading: boolean;
  chapters: Chapter[];
  chaptersLoading: boolean;
  readChapters: Set<string>;
  lastChapterId: string | null;
  isFavorite: boolean;
  inLibrary: boolean;
  onToggleFavorite: () => void;
  onToggleLibrary: () => void;
  onOpenChapter: (chapterId: string) => void;
};

function chapterLabel(c: Chapter): string {
  const num = c.number ? `Chapter ${c.number}` : "Oneshot";
  return c.title ? `${num} · ${c.title}` : num;
}

export default function MangaDetail({
  item,
  detail,
  detailLoading,
  chapters,
  chaptersLoading,
  readChapters,
  lastChapterId,
  isFavorite,
  inLibrary,
  onToggleFavorite,
  onToggleLibrary,
  onOpenChapter,
}: Props) {
  const [descending, setDescending] = useState(true);

  const cover = detail?.cover ?? item.cover;
  const title = detail?.title ?? item.title;
  const meta = detail ?? item;

  const ordered = useMemo(
    () => (descending ? [...chapters].reverse() : chapters),
    [chapters, descending],
  );

  // First (lowest) chapter for "Start reading"; the resume target if any.
  const firstChapter = chapters[0] ?? null;
  const resumeChapter = lastChapterId
    ? chapters.find((c) => c.id === lastChapterId) ?? null
    : null;

  return (
    <div className="relative flex flex-col h-full bg-[var(--surface-1,#111)] text-neutral-100">
      {/* Hero */}
      <div className="relative shrink-0">
        {cover && (
          <div
            aria-hidden
            className="absolute inset-0 bg-cover bg-center opacity-25 blur-2xl scale-110"
            style={{ backgroundImage: `url(${cover})` }}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[var(--surface-1,#111)] via-[var(--surface-1,#111)]/70 to-transparent" />
        <div className="relative flex gap-5 p-6">
          <div className="shrink-0 w-32 sm:w-40 aspect-[2/3] rounded-xl overflow-hidden bg-black/60 ring-1 ring-white/10">
            {cover ? (
              <img src={cover} alt={title} className="w-full h-full object-cover" />
            ) : (
              <span className="grid place-items-center w-full h-full text-neutral-600">
                <BookOpen size={36} />
              </span>
            )}
          </div>
          <div className="min-w-0 flex flex-col">
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight leading-tight">
              {title}
            </h1>
            <div className="mt-1 text-[12px] text-neutral-400 flex flex-wrap gap-x-2 gap-y-0.5">
              {meta.year != null && <span>{meta.year}</span>}
              {meta.status && meta.status !== "unknown" && (
                <span className="capitalize">· {meta.status}</span>
              )}
              {detail?.authors && detail.authors.length > 0 && (
                <span>· {detail.authors.slice(0, 2).join(", ")}</span>
              )}
              {!chaptersLoading && <span>· {chapters.length} chapters</span>}
            </div>

            {detail?.tags && detail.tags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {detail.tags.slice(0, 6).map((t) => (
                  <span
                    key={t}
                    className="text-[10.5px] px-2 py-0.5 rounded-full bg-white/10 text-neutral-300"
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}

            <div className="mt-auto pt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!firstChapter}
                onClick={() =>
                  onOpenChapter((resumeChapter ?? firstChapter)!.id)
                }
                className="inline-flex items-center gap-1.5 rounded-lg bg-violet-500 hover:bg-violet-400 disabled:opacity-40 disabled:hover:bg-violet-500 px-3.5 py-1.5 text-[13px] font-medium text-white transition-colors"
              >
                <Play size={14} fill="currentColor" />
                {resumeChapter
                  ? `Continue · Ch. ${resumeChapter.number ?? "?"}`
                  : "Start reading"}
              </button>
              <button
                type="button"
                onClick={onToggleLibrary}
                className={clsx(
                  "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors",
                  inLibrary
                    ? "bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25"
                    : "bg-white/10 text-neutral-200 hover:bg-white/15",
                )}
              >
                {inLibrary ? <Check size={14} /> : <Plus size={14} />}
                {inLibrary ? "In library" : "Add to library"}
              </button>
              <button
                type="button"
                onClick={onToggleFavorite}
                aria-pressed={isFavorite}
                className={clsx(
                  "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors",
                  isFavorite
                    ? "bg-rose-500/90 text-white hover:bg-rose-500"
                    : "bg-white/10 text-neutral-200 hover:bg-white/15",
                )}
              >
                <Heart size={14} fill={isFavorite ? "currentColor" : "none"} />
                Favorite
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Body: description + chapters */}
      <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-6 space-y-5">
        {detailLoading ? (
          <div className="flex items-center gap-2 text-sm text-neutral-400">
            <Loader2 size={14} className="animate-spin" /> Loading details…
          </div>
        ) : (
          detail?.description && (
            <p className="text-[13px] leading-relaxed text-neutral-300 whitespace-pre-line">
              {detail.description}
            </p>
          )
        )}

        <div>
          <div className="flex items-center justify-between mb-2 sticky top-0 -mx-1 px-1 py-1 bg-[var(--surface-1,#111)]/80 backdrop-blur z-10">
            <h2 className="text-sm font-semibold text-neutral-100">Chapters</h2>
            <button
              type="button"
              onClick={() => setDescending((v) => !v)}
              className="inline-flex items-center gap-1 text-[11.5px] text-neutral-400 hover:text-white"
            >
              <ArrowDownUp size={12} />
              {descending ? "Newest first" : "Oldest first"}
            </button>
          </div>

          {chaptersLoading ? (
            <div className="flex items-center gap-2 text-sm text-neutral-400 py-4">
              <Loader2 size={14} className="animate-spin" /> Loading chapters…
            </div>
          ) : chapters.length === 0 ? (
            <div className="text-sm text-neutral-500 py-4">
              No English chapters found for this source.
            </div>
          ) : (
            <ul className="space-y-px">
              {ordered.map((c) => {
                const read = readChapters.has(c.id);
                const isResume = c.id === lastChapterId;
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => onOpenChapter(c.id)}
                      className={clsx(
                        "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors",
                        isResume
                          ? "bg-violet-500/15 hover:bg-violet-500/25"
                          : "hover:bg-white/5",
                      )}
                    >
                      <span
                        className={clsx(
                          "shrink-0 w-1.5 h-1.5 rounded-full",
                          read ? "bg-neutral-600" : "bg-violet-400",
                        )}
                        title={read ? "Read" : "Unread"}
                      />
                      <span className="min-w-0 flex-1">
                        <span
                          className={clsx(
                            "block text-[13px] truncate",
                            read ? "text-neutral-500" : "text-neutral-100",
                          )}
                        >
                          {chapterLabel(c)}
                        </span>
                        <span className="block text-[10.5px] text-neutral-500 truncate">
                          {[
                            c.volume ? `Vol. ${c.volume}` : null,
                            c.scanlator,
                            c.publishedAt
                              ? new Date(c.publishedAt).toLocaleDateString()
                              : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </span>
                      {isResume && (
                        <span className="shrink-0 text-[10px] font-semibold text-violet-300">
                          RESUME
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
