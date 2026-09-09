"use client";
import clsx from "clsx";
import type { ReactNode } from "react";
import { usePrivacy } from "@/lib/privacy";

/**
 * Wraps a monetary amount (or any sensitive value). When privacy mode is on,
 * the content is blurred so balances can be hidden from shoulder-surfers —
 * like the "hide balance" toggle in banking apps. Width is preserved so the
 * layout never shifts when toggling.
 */
export default function Sensitive({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const { hidden } = usePrivacy();
  return (
    <span
      className={clsx(
        "transition-[filter] duration-200",
        hidden && "blur-[6px] select-none pointer-events-none",
        className,
      )}
    >
      {children}
    </span>
  );
}
