"use client";
import { useMemo } from "react";
import {
  RefreshCw,
  Focus,
  Tv as TvIcon,
  Radio as RadioIcon,
  Settings as SettingsIcon,
} from "lucide-react";
import clsx from "clsx";
import Combobox, { type ComboboxOption } from "@/components/Combobox";
import type { TvSource } from "@/lib/tv/sources";
import type { MediaKind } from "@/lib/tv/storage";

export type TvFilters = {
  search: string;
  /** Selected country codes; empty = all countries. */
  countries: string[];
  /** Selected genre/category id; null = all genres. */
  genre: string | null;
};

type Props = {
  resultCount: number;
  totalCount: number;
  onRefresh: () => void;
  isRefreshing: boolean;
  fetchedAt: number | null;
  focusMode: boolean;
  onToggleFocus: () => void;
  sources: TvSource[];
  activeSourceId: string;
  onChangeSource: (id: string) => void;
  onManagePlaylists: () => void;
  mediaKind: MediaKind;
  onChangeMediaKind: (kind: MediaKind) => void;
};

function formatAgo(ts: number | null): string {
  if (!ts) return "";
  const ms = Date.now() - ts;
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
}

export default function TopToolbar({
  resultCount,
  totalCount,
  onRefresh,
  isRefreshing,
  fetchedAt,
  focusMode,
  onToggleFocus,
  sources,
  activeSourceId,
  onChangeSource,
  onManagePlaylists,
  mediaKind,
  onChangeMediaKind,
}: Props) {
  const sourceOptions = useMemo<ComboboxOption[]>(
    () => sources.map((s) => ({ value: s.id, label: s.name })),
    [sources],
  );
  const activeSource = sources.find((s) => s.id === activeSourceId);
  const isRadio = mediaKind === "radio";
  const noun = isRadio ? "stations" : "channels";
  return (
    // `relative z-30` lifts the toolbar to its own stacking context so the
    // Combobox dropdown — which can overflow downward over the video below —
    // renders ABOVE the player instead of being painted under it. The video
    // element (and its native HTML5 controls) implicitly establish a stacking
    // context that beats the toolbar's `backdrop-filter` context unless we
    // give the toolbar an explicit z-index.
    // `relative z-30` lifts the toolbar to its own stacking context so the
    // Combobox dropdown — which can overflow downward over the video below —
    // renders ABOVE the player instead of being painted under it. The video
    // element (and its native HTML5 controls) implicitly establish a stacking
    // context that beats the toolbar's `backdrop-filter` context unless we
    // give the toolbar an explicit z-index.
    <div className="relative z-30 shrink-0 border-b border-[var(--border-1)] bg-[var(--background)]/95 backdrop-blur supports-[backdrop-filter]:bg-[var(--background)]/70">
      <div className="px-2 md:px-3 py-2 flex items-center gap-2 flex-nowrap overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {/* TV / Radio segmented toggle */}
        <div className="shrink-0 inline-flex items-center p-0.5 rounded-lg bg-white/[0.04] border border-white/10">
          <button
            type="button"
            onClick={() => onChangeMediaKind("tv")}
            aria-pressed={!isRadio}
            title="Live TV"
            className={clsx(
              "h-8 px-2.5 inline-flex items-center gap-1.5 rounded-[7px] text-[12px] transition-colors",
              !isRadio
                ? "bg-violet-500/25 text-violet-100"
                : "text-neutral-400 hover:text-neutral-200",
            )}
          >
            <TvIcon size={14} strokeWidth={2} />
            TV
          </button>
          <button
            type="button"
            onClick={() => onChangeMediaKind("radio")}
            aria-pressed={isRadio}
            title="Radio"
            className={clsx(
              "h-8 px-2.5 inline-flex items-center gap-1.5 rounded-[7px] text-[12px] transition-colors",
              isRadio
                ? "bg-violet-500/25 text-violet-100"
                : "text-neutral-400 hover:text-neutral-200",
            )}
          >
            <RadioIcon size={14} strokeWidth={2} />
            Radio
          </button>
        </div>

        {/* Source picker + playlist manager — TV only (radio has a single
            built-in directory). */}
        {!isRadio && (
          <>
            <div className="shrink-0">
              <Combobox
                value={activeSourceId}
                onChange={(v) => onChangeSource(v ?? "iptv-org")}
                options={sourceOptions}
                placeholder="Source"
                className="w-[180px]"
                clearable={false}
              />
            </div>
            <button
              type="button"
              onClick={onManagePlaylists}
              className="shrink-0 grid place-items-center w-9 h-9 rounded-lg bg-white/[0.04] border border-white/10 hover:bg-white/[0.06] text-neutral-300"
              title={activeSource ? `Manage playlists (${activeSource.name})` : "Manage TV playlists"}
              aria-label="Manage TV playlists"
            >
              <SettingsIcon size={14} />
            </button>
          </>
        )}

        {/* Push the count + actions to the right. Search + country/language
            filters now live inside the channel browse pane (ChannelFilters). */}
        <div className="flex-1" />

        {/* Compact counts — full detail in a tooltip so the row stays tight */}
        <span
          className="shrink-0 hidden md:inline-block text-[11px] text-neutral-500 tabular-nums px-1"
          title={
            fetchedAt
              ? `${resultCount.toLocaleString()} of ${totalCount.toLocaleString()} ${noun} · updated ${formatAgo(fetchedAt)} ago`
              : `${resultCount.toLocaleString()} of ${totalCount.toLocaleString()} ${noun}`
          }
        >
          <span className="text-neutral-300 font-medium">
            {resultCount.toLocaleString()}
          </span>
          <span className="text-neutral-600"> / {totalCount.toLocaleString()}</span>
        </span>

        <button
          type="button"
          onClick={onRefresh}
          disabled={isRefreshing}
          className="shrink-0 grid place-items-center w-9 h-9 rounded-lg bg-white/[0.04] border border-white/10 hover:bg-white/[0.06] text-neutral-300 disabled:opacity-50"
          aria-label={`Refresh ${noun}`}
          title={
            fetchedAt
              ? `Refresh (updated ${formatAgo(fetchedAt)} ago)`
              : `Refresh ${noun} list`
          }
        >
          <RefreshCw size={14} className={clsx(isRefreshing && "animate-spin")} />
        </button>

        {/* Focus toggle */}
        <button
          type="button"
          onClick={onToggleFocus}
          aria-pressed={focusMode}
          title={focusMode ? "Exit focus mode" : "Focus mode (hide app nav)"}
          className={clsx(
            "shrink-0 h-9 px-3 inline-flex items-center gap-1.5 rounded-lg text-[12px] border transition-colors",
            focusMode
              ? "bg-white/15 border-white/25 text-white hover:bg-white/20"
              : "bg-white/[0.04] border-white/10 text-neutral-300 hover:bg-white/[0.06]",
          )}
        >
          <Focus size={14} />
          Focus
        </button>
      </div>
    </div>
  );
}
