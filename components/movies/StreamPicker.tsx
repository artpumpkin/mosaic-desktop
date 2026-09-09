"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Zap,
  Users,
  ArrowDownWideNarrow,
  List,
  AlignJustify,
} from "lucide-react";
import clsx from "clsx";
import type { AddonId, Stream } from "@/lib/movies/types";
import { ADDON_LABELS } from "@/lib/movies/types";
import { prewarmStream } from "@/lib/movies/torrentio";

type SortKey = "seeders" | "size" | "quality" | "name";
type ViewMode = "comfy" | "compact";

type Props = {
  streams: Stream[];
  activeIndex: number;
  onPick: (index: number) => void;
};

const QUALITY_ORDER: Stream["quality"][] = [
  "4K",
  "1080p",
  "720p",
  "480p",
  "SD",
];

const ADDON_ORDER: AddonId[] = ["torrentio", "comet", "mediafusion"];

// Per-source chip/badge colours so each addon is recognisable at a glance.
const ADDON_TONE: Record<AddonId, { on: string; badge: string }> = {
  torrentio: {
    on: "bg-sky-500/20 border-sky-400/40 text-sky-100",
    badge: "bg-sky-500/15 text-sky-200 ring-sky-400/30",
  },
  comet: {
    on: "bg-fuchsia-500/20 border-fuchsia-400/40 text-fuchsia-100",
    badge: "bg-fuchsia-500/15 text-fuchsia-200 ring-fuchsia-400/30",
  },
  mediafusion: {
    on: "bg-teal-500/20 border-teal-400/40 text-teal-100",
    badge: "bg-teal-500/15 text-teal-200 ring-teal-400/30",
  },
};

// Compact badge shown on each stream row marking which addon(s) surfaced it.
function SourceBadges({ addons }: { addons: AddonId[] }) {
  return (
    <>
      {ADDON_ORDER.filter((a) => addons.includes(a)).map((a) => (
        <span
          key={a}
          title={`Source: ${ADDON_LABELS[a]}`}
          className={clsx(
            "inline-flex items-center px-1 py-px rounded-[3px] ring-1 text-[9px] font-semibold uppercase tracking-wide",
            ADDON_TONE[a].badge,
          )}
        >
          {ADDON_LABELS[a]}
        </span>
      ))}
    </>
  );
}

const SORT_LABELS: Record<SortKey, string> = {
  seeders: "Seeders",
  size: "Size",
  quality: "Quality",
  name: "Name",
};

export default function StreamPicker({ streams, activeIndex, onPick }: Props) {
  const [view, setView] = useState<ViewMode>("comfy");
  const [sort, setSort] = useState<SortKey>("seeders");
  const [hdrOnly, setHdrOnly] = useState(false);
  const [rdOnly, setRdOnly] = useState(false);
  const [qualityFilter, setQualityFilter] = useState<Set<Stream["quality"]>>(
    new Set(),
  );
  const [sourceFilter, setSourceFilter] = useState<Set<AddonId>>(new Set());

  // Default the picker to 1080p (the sweet spot for size vs quality) once
  // streams arrive — leaves 4K/720p a tap away. The mpv player decodes any
  // container, so there's no MP4-only "playable" filter anymore.
  const defaultedRef = useRef(false);
  useEffect(() => {
    if (defaultedRef.current || streams.length === 0) return;
    defaultedRef.current = true;
    if (streams.some((s) => s.quality === "1080p")) {
      setQualityFilter(new Set(["1080p"]));
    }
  }, [streams]);

  // Debounced pre-warm: when the user pauses on a row for ~350ms we kick off
  // the magnet→metadata fetch in the background so a subsequent click resolves
  // near-instantly instead of waiting on a cold DHT lookup. Hovering past rows
  // quickly warms nothing — only the row they settle on.
  const hoverTimer = useRef<number | null>(null);
  const onHoverPrewarm = (stream: Stream) => {
    if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => prewarmStream(stream), 350);
  };
  const cancelHoverPrewarm = () => {
    if (hoverTimer.current !== null) {
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
  };
  useEffect(() => () => cancelHoverPrewarm(), []);

  // Carry the original index alongside each stream so the filtered/sorted
  // view can still address streams in the parent's full list via onPick.
  const indexed = useMemo(
    () => streams.map((s, idx) => ({ stream: s, idx })),
    [streams],
  );

  const availableQualities = useMemo(() => {
    const s = new Set<Stream["quality"]>();
    for (const { stream } of indexed) s.add(stream.quality);
    return QUALITY_ORDER.filter((q) => s.has(q));
  }, [indexed]);

  // Sources present in the current stream list — drives the source filter chips
  // so we only show chips for addons that actually returned something.
  const availableSources = useMemo(() => {
    const s = new Set<AddonId>();
    for (const { stream } of indexed) for (const a of stream.addons) s.add(a);
    return ADDON_ORDER.filter((a) => s.has(a));
  }, [indexed]);

  const filtered = useMemo(() => {
    return indexed.filter(({ stream }) => {
      if (hdrOnly && !stream.hdr) return false;
      if (rdOnly && stream.source !== "realdebrid") return false;
      if (qualityFilter.size > 0 && !qualityFilter.has(stream.quality))
        return false;
      if (
        sourceFilter.size > 0 &&
        !stream.addons.some((a) => sourceFilter.has(a))
      )
        return false;
      return true;
    });
  }, [indexed, hdrOnly, rdOnly, qualityFilter, sourceFilter]);

  const sorted = useMemo(() => {
    const list = [...filtered];
    switch (sort) {
      case "seeders":
        list.sort((a, b) => b.stream.seeders - a.stream.seeders);
        break;
      case "size":
        list.sort(
          (a, b) => (b.stream.sizeBytes ?? 0) - (a.stream.sizeBytes ?? 0),
        );
        break;
      case "quality":
        list.sort((a, b) => b.stream.qualityRank - a.stream.qualityRank);
        break;
      case "name":
        list.sort((a, b) => {
          const aName =
            a.stream.raw.behaviorHints?.filename ?? a.stream.raw.title ?? "";
          const bName =
            b.stream.raw.behaviorHints?.filename ?? b.stream.raw.title ?? "";
          return aName.localeCompare(bName);
        });
        break;
    }
    return list;
  }, [filtered, sort]);

  const grouped = useMemo(() => {
    const groups = new Map<
      Stream["quality"],
      { stream: Stream; idx: number }[]
    >();
    sorted.forEach(({ stream, idx }) => {
      const arr = groups.get(stream.quality) ?? [];
      arr.push({ stream, idx });
      groups.set(stream.quality, arr);
    });
    return QUALITY_ORDER.filter((q) => groups.has(q)).map((q) => ({
      quality: q,
      rows: groups.get(q)!,
    }));
  }, [sorted]);

  const toggleQ = (q: Stream["quality"]) => {
    setQualityFilter((prev) => {
      const next = new Set(prev);
      if (next.has(q)) next.delete(q);
      else next.add(q);
      return next;
    });
  };

  const toggleSource = (a: AddonId) => {
    setSourceFilter((prev) => {
      const next = new Set(prev);
      if (next.has(a)) next.delete(a);
      else next.add(a);
      return next;
    });
  };

  if (streams.length === 0) {
    return (
      <div className="rounded-xl border border-white/5 bg-black/30 p-6 text-center text-sm text-neutral-400">
        No streams available for this title yet. The sources may still be
        indexing — try again in a few seconds.
      </div>
    );
  }

  return (
    <div className="space-y-3 min-w-0">
      {/* Toolbar — view mode, sort, filter chips */}
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="inline-flex bg-white/5 border border-white/10 rounded-md p-0.5">
          <button
            type="button"
            onClick={() => setView("comfy")}
            className={clsx(
              "px-1.5 py-0.5 rounded grid place-items-center transition-colors",
              view === "comfy"
                ? "bg-white/15 text-white"
                : "text-neutral-400 hover:text-white",
            )}
            aria-pressed={view === "comfy"}
            title="Detailed view"
          >
            <List size={12} />
          </button>
          <button
            type="button"
            onClick={() => setView("compact")}
            className={clsx(
              "px-1.5 py-0.5 rounded grid place-items-center transition-colors",
              view === "compact"
                ? "bg-white/15 text-white"
                : "text-neutral-400 hover:text-white",
            )}
            aria-pressed={view === "compact"}
            title="Compact view"
          >
            <AlignJustify size={12} />
          </button>
        </div>

        <label className="inline-flex items-center gap-1 bg-white/5 border border-white/10 rounded-md pl-1.5 pr-0.5 py-0.5 text-neutral-300">
          <ArrowDownWideNarrow size={11} />
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="!bg-transparent !border-0 !p-0 !pr-3 !shadow-none text-[11px] focus:!outline-none focus:!shadow-none appearance-none cursor-pointer"
          >
            {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
              <option key={k} value={k} className="bg-neutral-900">
                {SORT_LABELS[k]}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={() => setHdrOnly((v) => !v)}
          aria-pressed={hdrOnly}
          className={clsx(
            "px-1.5 py-0.5 rounded-md border text-[10.5px] transition-colors",
            hdrOnly
              ? "bg-amber-500/20 border-amber-400/40 text-amber-100"
              : "bg-white/5 border-white/10 text-neutral-400 hover:text-white",
          )}
        >
          HDR
        </button>
        <button
          type="button"
          onClick={() => setRdOnly((v) => !v)}
          aria-pressed={rdOnly}
          className={clsx(
            "px-1.5 py-0.5 rounded-md border text-[10.5px] transition-colors",
            rdOnly
              ? "bg-emerald-500/20 border-emerald-400/40 text-emerald-100"
              : "bg-white/5 border-white/10 text-neutral-400 hover:text-white",
          )}
        >
          RD
        </button>
        {availableSources.length > 1 &&
          availableSources.map((a) => {
            const on = sourceFilter.has(a);
            return (
              <button
                key={a}
                type="button"
                onClick={() => toggleSource(a)}
                aria-pressed={on}
                title={`Show only ${ADDON_LABELS[a]} sources`}
                className={clsx(
                  "px-1.5 py-0.5 rounded-md border text-[10.5px] transition-colors",
                  on
                    ? ADDON_TONE[a].on
                    : "bg-white/5 border-white/10 text-neutral-400 hover:text-white",
                )}
              >
                {ADDON_LABELS[a]}
              </button>
            );
          })}
        {availableSources.length > 1 && (
          <span className="mx-0.5 h-4 w-px self-center bg-white/10" />
        )}
        {availableQualities.map((q) => {
          const on = qualityFilter.has(q);
          return (
            <button
              key={q}
              type="button"
              onClick={() => toggleQ(q)}
              aria-pressed={on}
              className={clsx(
                "px-1.5 py-0.5 rounded-md border text-[10.5px] transition-colors",
                on
                  ? "bg-violet-500/20 border-violet-400/40 text-violet-100"
                  : "bg-white/5 border-white/10 text-neutral-400 hover:text-white",
              )}
            >
              {q}
            </button>
          );
        })}
      </div>

      {sorted.length === 0 ? (
        <div className="rounded-xl border border-white/5 bg-black/30 p-4 text-center text-[12px] text-neutral-500 space-y-2">
          <div>No streams match the current filters.</div>
          {(qualityFilter.size > 0 || sourceFilter.size > 0) && (
            <button
              type="button"
              onClick={() => {
                setQualityFilter(new Set());
                setSourceFilter(new Set());
              }}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-white/5 border border-white/10 text-neutral-300 hover:text-white text-[11.5px]"
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        grouped.map(({ quality, rows }) => (
          <div key={quality} className="min-w-0">
            <div className="text-[10.5px] uppercase tracking-wider text-neutral-500 mb-1 px-1">
              {quality} · {rows.length}
            </div>
            <div className="space-y-1">
              {rows.map(({ stream, idx }) => {
                const active = idx === activeIndex;
                const name =
                  stream.raw.behaviorHints?.filename ??
                  stream.raw.title?.split("\n")[0] ??
                  "Untitled";

                if (view === "compact") {
                  return (
                    <button
                      key={`${stream.raw.infoHash ?? stream.raw.url ?? idx}-${idx}`}
                      type="button"
                      onClick={() => onPick(idx)}
                      onMouseEnter={() => onHoverPrewarm(stream)}
                      onMouseLeave={cancelHoverPrewarm}
                      className={clsx(
                        "w-full text-left rounded-md border px-2 py-1 transition-colors flex items-center gap-2 min-w-0",
                        active
                          ? "bg-violet-500/20 border-violet-400/40 text-violet-100"
                          : "bg-white/[0.03] border-white/10 text-neutral-200 hover:bg-white/[0.06] hover:border-white/15",
                      )}
                    >
                      <span className="flex-1 min-w-0 text-[11.5px] truncate">
                        {name}
                      </span>
                      <span className="shrink-0 text-[10.5px] text-neutral-400 inline-flex items-center gap-1.5">
                        <SourceBadges addons={stream.addons} />
                        <span className="inline-flex items-center gap-0.5">
                          <Users size={9} />
                          {stream.seeders}
                        </span>
                        {stream.sizeLabel && <span>· {stream.sizeLabel}</span>}
                      </span>
                    </button>
                  );
                }

                return (
                  <button
                    key={`${stream.raw.infoHash ?? stream.raw.url ?? idx}-${idx}`}
                    type="button"
                    onClick={() => onPick(idx)}
                    onMouseEnter={() => onHoverPrewarm(stream)}
                    onMouseLeave={cancelHoverPrewarm}
                    className={clsx(
                      "w-full text-left rounded-lg border px-3 py-2 transition-colors flex items-center gap-3 min-w-0",
                      active
                        ? "bg-violet-500/20 border-violet-400/40 text-violet-100"
                        : "bg-white/[0.03] border-white/10 text-neutral-200 hover:bg-white/[0.06] hover:border-white/15",
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] font-medium truncate">
                        {name}
                      </div>
                      <div className="text-[10.5px] text-neutral-400 flex items-center gap-x-1.5 gap-y-0.5 mt-0.5 flex-wrap">
                        <SourceBadges addons={stream.addons} />
                        {stream.source === "realdebrid" && (
                          <span className="inline-flex items-center gap-1 text-emerald-300">
                            <Zap size={10} fill="currentColor" /> RD
                          </span>
                        )}
                        {stream.source === "torrent" && (
                          <span className="inline-flex items-center gap-1 text-amber-300">
                            P2P
                          </span>
                        )}
                        {stream.provider && <span>{stream.provider}</span>}
                        {stream.codec && <span>· {stream.codec}</span>}
                        {stream.container !== "unknown" && (
                          <span title="Container">
                            · {stream.container.toUpperCase()}
                          </span>
                        )}
                        {stream.hdr && (
                          <span className="text-amber-200">· HDR</span>
                        )}
                        {stream.language && <span>· {stream.language}</span>}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-[11px] text-neutral-300 inline-flex items-center gap-1">
                        <Users size={10} /> {stream.seeders}
                      </div>
                      {stream.sizeLabel && (
                        <div className="text-[10.5px] text-neutral-500">
                          {stream.sizeLabel}
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
