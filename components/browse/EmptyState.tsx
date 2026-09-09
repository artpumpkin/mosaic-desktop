"use client";
import type { ReactNode } from "react";

/**
 * Centered empty/zero-state shared by the sections — an icon, a line of copy,
 * and an optional call-to-action (e.g. "Choose music folder").
 */
type Props = {
  icon?: ReactNode;
  title: string;
  hint?: string;
  action?: ReactNode;
};

export default function EmptyState({ icon, title, hint, action }: Props) {
  return (
    <div className="grid place-items-center py-20 text-center">
      {icon && <div className="text-neutral-600 mb-3">{icon}</div>}
      <p className="text-sm text-neutral-200">{title}</p>
      {hint && <p className="text-[12.5px] text-neutral-500 mt-1.5 max-w-sm">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
