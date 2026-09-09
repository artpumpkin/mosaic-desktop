"use client";
import clsx from "clsx";
import { LucideIcon } from "lucide-react";
import { KeyboardEvent, useRef } from "react";

export type TabItem = {
  key: string;
  label: string;
  icon?: LucideIcon;
};

export function TabButton({
  active,
  label,
  icon: Icon,
  onSelect,
  onKeyNav,
}: {
  active: boolean;
  label: string;
  icon?: LucideIcon;
  onSelect: () => void;
  onKeyNav?: (e: KeyboardEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      onClick={onSelect}
      onKeyDown={onKeyNav}
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors",
        active
          ? "bg-white/[0.06] text-neutral-100 border border-white/10"
          : "text-neutral-400 border border-transparent hover:text-neutral-200 hover:bg-white/[0.04]"
      )}
    >
      {Icon && <Icon size={14} strokeWidth={2} />}
      {label}
    </button>
  );
}

export default function Tabs({
  tabs,
  active,
  onChange,
  className,
  "aria-label": ariaLabel,
}: {
  tabs: TabItem[];
  active: string;
  onChange: (key: string) => void;
  className?: string;
  "aria-label"?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  function handleKeyNav(e: KeyboardEvent<HTMLButtonElement>) {
    const idx = tabs.findIndex((t) => t.key === active);
    if (idx < 0) return;
    let next = idx;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      next = (idx + 1) % tabs.length;
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      next = (idx - 1 + tabs.length) % tabs.length;
    } else if (e.key === "Home") {
      next = 0;
    } else if (e.key === "End") {
      next = tabs.length - 1;
    } else {
      return;
    }
    e.preventDefault();
    onChange(tabs[next].key);
    const btns = ref.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    btns?.[next]?.focus();
  }

  return (
    <div
      ref={ref}
      role="tablist"
      aria-label={ariaLabel}
      className={clsx(
        "inline-flex items-center gap-1 rounded-xl bg-white/[0.02] border border-white/5 p-1",
        className
      )}
    >
      {tabs.map((t) => (
        <TabButton
          key={t.key}
          active={t.key === active}
          label={t.label}
          icon={t.icon}
          onSelect={() => onChange(t.key)}
          onKeyNav={handleKeyNav}
        />
      ))}
    </div>
  );
}
