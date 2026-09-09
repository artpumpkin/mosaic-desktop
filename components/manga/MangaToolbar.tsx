"use client";
import { useEffect, useRef, useState } from "react";
import {
  Search,
  Maximize2,
  Minimize2,
  X,
  ChevronDown,
  Check,
  Settings2,
  BookOpen,
  Globe,
  ServerCog,
} from "lucide-react";
import clsx from "clsx";
import type { MangaSource } from "@/lib/manga/types";

type Props = {
  search: string;
  onSearch: (v: string) => void;
  sources: MangaSource[];
  activeId: string;
  onPickSource: (id: string) => void;
  focusMode: boolean;
  onToggleFocus: () => void;
  onManageSources: () => void;
};

function SourceIcon({ kind, size = 13 }: { kind: string; size?: number }) {
  if (kind === "suwayomi") return <ServerCog size={size} />;
  if (kind === "comick") return <Globe size={size} />;
  return <BookOpen size={size} />;
}

export default function MangaToolbar({
  search,
  onSearch,
  sources,
  activeId,
  onPickSource,
  focusMode,
  onToggleFocus,
  onManageSources,
}: Props) {
  const [open, setOpen] = useState(false);
  const ddRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ddRef.current && !ddRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const active = sources.find((s) => s.id === activeId) ?? sources[0];

  return (
    <div className="sticky top-0 z-30 backdrop-blur-2xl bg-[var(--background)]/70 border-b border-white/5">
      <div className="flex items-center gap-2.5 px-4 md:px-6 py-3">
        {/* Search */}
        <div className="relative flex-1 max-w-xl">
          <span className="pointer-events-none absolute inset-y-0 left-0 grid w-11 place-items-center text-neutral-500">
            <Search size={16} />
          </span>
          <input
            type="text"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search titles…"
            className="w-full rounded-full bg-white/[0.06] border border-white/10 focus:border-violet-400/60 focus:bg-white/[0.09] focus:outline-none focus:ring-4 focus:ring-violet-500/10 pl-11 pr-9 py-2 text-[13.5px] text-neutral-100 placeholder:text-neutral-500 transition-all"
          />
          {search && (
            <button
              type="button"
              onClick={() => onSearch("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 grid place-items-center w-6 h-6 rounded-full text-neutral-400 hover:text-white hover:bg-white/10"
              aria-label="Clear search"
            >
              <X size={13} />
            </button>
          )}
        </div>

        {/* Source dropdown */}
        <div className="relative" ref={ddRef}>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="inline-flex items-center gap-2 rounded-full bg-white/[0.06] hover:bg-white/[0.1] border border-white/10 pl-2.5 pr-2 py-2 text-[13px] text-neutral-100 transition-colors"
          >
            <span className="grid place-items-center w-5 h-5 rounded-md bg-amber-500/90 text-white">
              <SourceIcon kind={active?.kind ?? "mangadex"} size={12} />
            </span>
            <span className="max-w-[160px] truncate">{active?.name ?? "Source"}</span>
            <ChevronDown size={14} className={clsx("transition-transform", open && "rotate-180")} />
          </button>

          {open && (
            <div className="absolute right-0 mt-2 w-72 rounded-2xl border border-white/10 bg-neutral-900/95 backdrop-blur-2xl shadow-2xl shadow-black/60 overflow-hidden z-50">
              <div className="px-3 pt-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                Source
              </div>
              <div className="max-h-72 overflow-y-auto pb-1">
                {sources.map((s) => {
                  const isActive = s.id === activeId;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      disabled={!s.enabled}
                      onClick={() => {
                        onPickSource(s.id);
                        setOpen(false);
                      }}
                      className={clsx(
                        "w-full flex items-center gap-2.5 px-3 py-2 text-left text-[13px] transition-colors",
                        s.enabled ? "hover:bg-white/[0.06]" : "opacity-40 cursor-not-allowed",
                        isActive && "bg-violet-500/10",
                      )}
                    >
                      <span className="grid place-items-center w-6 h-6 rounded-md bg-white/10 text-neutral-200">
                        <SourceIcon kind={s.kind} size={13} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-neutral-100">{s.name}</span>
                        {!s.enabled && (
                          <span className="block text-[10px] text-neutral-500">Disabled</span>
                        )}
                      </span>
                      {isActive && <Check size={15} className="text-violet-400" />}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onManageSources();
                }}
                className="w-full flex items-center gap-2 px-3 py-2.5 border-t border-white/10 text-[12.5px] text-neutral-300 hover:bg-white/[0.06] hover:text-white"
              >
                <Settings2 size={14} /> Manage sources…
              </button>
            </div>
          )}
        </div>

        {/* Focus toggle */}
        <button
          type="button"
          onClick={onToggleFocus}
          className={clsx(
            "grid place-items-center w-9 h-9 rounded-full border transition-colors shrink-0",
            focusMode
              ? "bg-violet-500/20 border-violet-400/40 text-violet-200"
              : "bg-white/[0.06] border-white/10 text-neutral-300 hover:bg-white/10",
          )}
          title={focusMode ? "Exit focus mode" : "Focus mode"}
        >
          {focusMode ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
        </button>
      </div>
    </div>
  );
}
