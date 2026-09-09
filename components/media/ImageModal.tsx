"use client";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X, Loader2 } from "lucide-react";

export default function ImageModal({
  name,
  src,
  subtitle,
  onError,
  onClose,
}: {
  name: string;
  src: string | null;
  subtitle?: string;
  onError?: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[120] bg-black/85 backdrop-blur-md grid place-items-center p-4 md:p-8"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-6xl flex flex-col items-center gap-2"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between w-full px-1">
          <div className="min-w-0">
            <div className="text-[13px] text-neutral-100 truncate">{name}</div>
            {subtitle && <div className="text-[11px] text-neutral-400">{subtitle}</div>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 grid place-items-center w-9 h-9 rounded-lg text-neutral-300 hover:text-white hover:bg-white/10"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={name}
            onError={onError}
            className="max-h-[80vh] max-w-full object-contain rounded-xl shadow-2xl"
          />
        ) : (
          <div className="h-[60vh] grid place-items-center">
            <Loader2 size={24} className="animate-spin text-neutral-500" />
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
