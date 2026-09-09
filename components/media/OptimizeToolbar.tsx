"use client";
import clsx from "clsx";
import { Image as ImageIcon, Film, Music, FileText, type LucideIcon } from "lucide-react";
import type { MediaKind } from "@/lib/media/types";

const TABS: { kind: MediaKind; label: string; icon: LucideIcon }[] = [
  { kind: "image", label: "Images", icon: ImageIcon },
  { kind: "video", label: "Video", icon: Film },
  { kind: "audio", label: "Audio", icon: Music },
  { kind: "pdf", label: "PDF", icon: FileText },
];

export default function OptimizeToolbar({
  active,
  counts,
  onChange,
}: {
  active: MediaKind;
  counts: Record<MediaKind, number>;
  onChange: (k: MediaKind) => void;
}) {
  return (
    <div className="inline-flex flex-wrap bg-white/5 border border-white/10 rounded-xl p-1 gap-1">
      {TABS.map(({ kind, label, icon: Icon }) => {
        const isActive = active === kind;
        const n = counts[kind] ?? 0;
        return (
          <button
            key={kind}
            type="button"
            onClick={() => onChange(kind)}
            className={clsx(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors",
              isActive
                ? "bg-white/[0.12] text-white shadow-sm"
                : "text-neutral-400 hover:text-white hover:bg-white/[0.05]",
            )}
          >
            <Icon size={14} />
            <span>{label}</span>
            {n > 0 && (
              <span
                className={clsx(
                  "ml-0.5 min-w-[16px] h-4 px-1 grid place-items-center rounded-full text-[10px] font-semibold",
                  isActive ? "bg-white/20 text-white" : "bg-white/10 text-neutral-300",
                )}
              >
                {n}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
