"use client";
import clsx from "clsx";
import { UploadCloud } from "lucide-react";

export default function DropZone({
  dragActive,
  label,
  onPick,
}: {
  dragActive: boolean;
  label: string;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      className={clsx(
        "w-full rounded-2xl border-2 border-dashed px-6 py-8 text-center transition-colors",
        dragActive
          ? "border-violet-400/60 bg-violet-500/10"
          : "border-white/15 bg-white/[0.02] hover:border-white/25 hover:bg-white/[0.04]",
      )}
    >
      <UploadCloud
        size={28}
        className={clsx("mx-auto mb-2", dragActive ? "text-violet-300" : "text-neutral-400")}
      />
      <div className="text-[13.5px] text-neutral-200 font-medium">
        Drop {label} here, or click to choose
      </div>
      <div className="text-[12px] text-neutral-500 mt-0.5">
        Files are processed locally; output is saved beside the original.
      </div>
    </button>
  );
}
