"use client";
import type { ReactNode } from "react";
import clsx from "clsx";
import Sidebar from "@/components/Sidebar";
import { LayoutProvider, useAppLayout } from "@/lib/appLayout";

function Shell({ children }: { children: ReactNode }) {
  const { isFullWidth, isWide } = useAppLayout();
  return (
    <>
      <Sidebar />
      <main
        className={clsx(
          "min-h-screen relative z-10",
          // Keep room for the sidebar unless it's hidden (focus/full mode).
          !isFullWidth && "md:pl-56",
        )}
      >
        <div
          className={
            // `isWide` (media sections) fills the pane edge-to-edge beside the
            // sidebar; `isFullWidth` (focus) hides the sidebar too. Everything
            // else stays in the centered reading column.
            isFullWidth || isWide
              ? "w-full"
              : "max-w-6xl mx-auto px-4 sm:px-5 md:px-8 pt-20 md:pt-10 pb-8 md:pb-10"
          }
        >
          {children}
        </div>
      </main>
    </>
  );
}

export default function AppShell({ children }: { children: ReactNode }) {
  return (
    <LayoutProvider>
      <Shell>{children}</Shell>
    </LayoutProvider>
  );
}
