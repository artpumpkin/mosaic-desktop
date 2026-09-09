"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Loader2 } from "lucide-react";

type Dim = { w: number; h: number } | null;

const ZOOMS = [1, 2, 4];

export default function CompareModal({
  name,
  beforeSrc,
  afterSrc,
  beforeLabel,
  afterLabel,
  onClose,
}: {
  name: string;
  beforeSrc: string | null;
  afterSrc: string | null;
  beforeLabel: string;
  afterLabel: string;
  onClose: () => void;
}) {
  const [pos, setPos] = useState(50);
  const [zoom, setZoom] = useState(1);
  const [beforeDim, setBeforeDim] = useState<Dim>(null);
  const [afterDim, setAfterDim] = useState<Dim>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const setFromClientX = useCallback((clientX: number) => {
    const el = stageRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos(Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100)));
  }, []);

  const loading = !beforeSrc || !afterSrc;
  const dimStr = (d: Dim) => (d ? `${d.w}×${d.h}` : "");

  return createPortal(
    <div
      className="fixed inset-0 z-[120] bg-black/85 backdrop-blur-md grid place-items-center p-4 md:p-8"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-6xl rounded-2xl overflow-hidden glass flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-white/10">
          <span className="text-[13px] font-medium text-neutral-100 truncate">{name}</span>
          <div className="flex items-center gap-2 shrink-0">
            <div className="inline-flex bg-white/5 border border-white/10 rounded-lg p-0.5 text-[11px]">
              {ZOOMS.map((z) => (
                <button
                  key={z}
                  type="button"
                  onClick={() => setZoom(z)}
                  className={`px-2 py-0.5 rounded-md transition-colors ${
                    zoom === z ? "bg-white/15 text-white" : "text-neutral-400 hover:text-white"
                  }`}
                >
                  {z === 1 ? "Fit" : `${z}×`}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="grid place-items-center w-8 h-8 rounded-lg text-neutral-400 hover:text-white hover:bg-white/10"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="h-[60vh] grid place-items-center">
            <Loader2 size={24} className="animate-spin text-neutral-500" />
          </div>
        ) : (
          <div className="relative overflow-auto max-h-[74vh] bg-[#0a0a0f]">
            <div
              ref={stageRef}
              className="relative select-none mx-auto"
              style={{ width: `${zoom * 100}%`, cursor: zoom > 1 ? "grab" : "ew-resize" }}
              onPointerDown={(e) => {
                dragging.current = true;
                setFromClientX(e.clientX);
              }}
              onPointerMove={(e) => dragging.current && setFromClientX(e.clientX)}
              onPointerUp={() => (dragging.current = false)}
              onPointerLeave={() => (dragging.current = false)}
            >
              {/* After (full) sets the box; Before overlays, clipped to the left. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={afterSrc}
                alt="optimized"
                className="block w-full h-auto"
                onLoad={(e) =>
                  setAfterDim({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
                }
              />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={beforeSrc}
                alt="original"
                className="absolute inset-0 w-full h-auto"
                style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}
                onLoad={(e) =>
                  setBeforeDim({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
                }
              />
              {/* Handle */}
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-white/90 shadow-[0_0_8px_rgba(0,0,0,0.6)] pointer-events-none"
                style={{ left: `${pos}%` }}
              >
                <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 grid place-items-center w-8 h-8 rounded-full bg-white text-black text-[11px] font-bold">
                  ↔
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Labels with real dimensions + sizes */}
        {!loading && (
          <div className="flex items-center justify-between gap-3 px-4 py-2 border-t border-white/10 text-[11.5px]">
            <span className="text-neutral-300">
              Original{beforeDim ? ` · ${dimStr(beforeDim)}` : ""} · {beforeLabel}
            </span>
            <span className="text-emerald-300">
              Result{afterDim ? ` · ${dimStr(afterDim)}` : ""} · {afterLabel}
            </span>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
