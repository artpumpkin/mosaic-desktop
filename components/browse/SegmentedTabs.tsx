"use client";
import type { ReactNode } from "react";
import clsx from "clsx";

/**
 * The pill-style segmented control used wherever a section toggles between a
 * small set of modes (Movies/Series, Podcasts/Music, All/Series/Movie, …).
 */
export type SegmentedTab<V extends string> = {
  value: V;
  label: string;
  icon?: ReactNode;
};

type Props<V extends string> = {
  value: V;
  onChange: (value: V) => void;
  tabs: SegmentedTab<V>[];
  className?: string;
};

export default function SegmentedTabs<V extends string>({
  value,
  onChange,
  tabs,
  className,
}: Props<V>) {
  return (
    <div
      className={clsx(
        "inline-flex bg-white/5 border border-white/10 rounded-lg p-0.5 text-[12.5px]",
        className,
      )}
    >
      {tabs.map((tab) => {
        const active = tab.value === value;
        return (
          <button
            key={tab.value}
            type="button"
            onClick={() => onChange(tab.value)}
            aria-pressed={active}
            className={clsx(
              "px-2.5 py-1 rounded-md flex items-center gap-1.5 transition-colors",
              active
                ? "bg-white/[0.12] text-white"
                : "text-neutral-400 hover:text-white",
            )}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}
