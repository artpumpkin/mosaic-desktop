"use client";
import type { ReactNode } from "react";

/**
 * Full-bleed page chrome shared by the entertainment sections. Breaks out of
 * AppShell's padded box, pins to the viewport height, and gives the inner
 * content a single owning scrollbar so a sticky toolbar stays put.
 *
 * An optional `header` (e.g. the audio NowPlayingBar) is pinned to the TOP,
 * outside the scroll area — Apple-Podcasts style — so it stays fixed while the
 * content scrolls beneath it. An optional `footer` sits outside the scroll area
 * at the bottom.
 *
 * The page runs edge-to-edge via useWide/useFullWidth (AppShell drops its
 * centered max-w cap + padding), so the shell just pins to the viewport
 * height — no negative-margin breakout needed.
 */
type Props = {
  toolbar?: ReactNode;
  children: ReactNode;
  header?: ReactNode;
  footer?: ReactNode;
  focusMode?: boolean;
};

export default function BrowseShell({ toolbar, children, header, footer }: Props) {
  return (
    <div className="h-screen flex flex-col bg-[var(--background)] overflow-hidden">
      {header}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {toolbar}
        <div className="px-4 md:px-6 py-5 md:py-8 space-y-10">{children}</div>
      </div>
      {footer}
    </div>
  );
}
