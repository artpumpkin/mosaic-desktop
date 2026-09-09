"use client";
import type { ReactNode } from "react";
import clsx from "clsx";

/**
 * Sticky toolbar bar shared by every section. Just the chrome (sticky
 * positioning, translucent backdrop, bottom hairline, wrapping flex row) —
 * sections drop their tabs, comboboxes, search and actions inside as children.
 */
type Props = {
  children: ReactNode;
  className?: string;
};

export default function BrowseToolbar({ children, className }: Props) {
  return (
    <div className="sticky top-0 z-30 bg-[var(--background)]/85 backdrop-blur-xl border-b border-white/5">
      <div
        className={clsx(
          "px-4 md:px-6 py-3 flex flex-wrap items-center gap-2",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}
