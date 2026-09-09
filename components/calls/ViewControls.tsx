"use client";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import {
  Tv,
  Focus,
  Columns2,
  Maximize2,
  Minimize2,
  Eye,
  EyeOff,
  ArrowUpLeft,
  ArrowUpRight,
  ArrowDownLeft,
  ArrowDownRight,
  type LucideIcon,
} from "lucide-react";
import type {
  CamSize,
  Corner,
  LayoutMode,
  ScreenFit,
  ViewPrefs,
} from "@/lib/calls/viewPrefs";

const PANEL_W = 296;
const GAP = 12;
const MARGIN = 8;

function positionFor(rect: DOMRect, height: number) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = rect.left + rect.width / 2 - PANEL_W / 2;
  left = Math.min(Math.max(MARGIN, left), vw - PANEL_W - MARGIN);
  let top = rect.top - GAP - height;
  if (top < MARGIN) {
    // Prefer below the anchor; clamp so the bottom stays inside the
    // viewport even if the panel is taller than the space available.
    top = Math.max(MARGIN, Math.min(rect.bottom + GAP, vh - height - MARGIN));
  }
  return { left, top };
}

export default function ViewControls({
  anchor,
  prefs,
  onChange,
  isFullscreen,
  onToggleFullscreen,
  onClose,
}: {
  anchor: HTMLElement;
  prefs: ViewPrefs;
  onChange: (next: ViewPrefs) => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reposition = () => {
      const el = ref.current;
      if (!el) return;
      const h = el.offsetHeight || 380;
      const { left, top } = positionFor(anchor.getBoundingClientRect(), h);
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
    };
    reposition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    // Re-position whenever the panel's own size changes — layout switches
    // (Split → Theater) reveal or hide sections, so the height grows and
    // the original top/left becomes wrong.
    const el = ref.current;
    const ro = el ? new ResizeObserver(reposition) : null;
    if (ro && el) ro.observe(el);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      ro?.disconnect();
    };
  }, [anchor]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target)) return;
      if (anchor.contains(target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [anchor, onClose]);

  const update = (patch: Partial<ViewPrefs>) => onChange({ ...prefs, ...patch });
  const isTheater = prefs.layout === "theater";
  const canShowCams = prefs.layout !== "spotlight";

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={ref}
      style={{
        position: "fixed",
        left: 0,
        top: 0,
        width: PANEL_W,
        maxHeight: `calc(100vh - ${MARGIN * 2}px)`,
        overflowY: "auto",
        zIndex: 90,
      }}
      className="rounded-xl bg-neutral-900 border border-white/10 shadow-2xl p-3 space-y-3 text-xs"
    >
      <div>
        <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-1.5">
          Layout
        </div>
        <div className="grid grid-cols-3 gap-1">
          <LayoutPick
            current={prefs.layout}
            value="theater"
            label="Theater"
            icon={Tv}
            onSelect={(v) => update({ layout: v, camsVisible: true })}
          />
          <LayoutPick
            current={prefs.layout}
            value="spotlight"
            label="Spotlight"
            icon={Focus}
            onSelect={(v) => update({ layout: v, camsVisible: false })}
          />
          <LayoutPick
            current={prefs.layout}
            value="sideBySide"
            label="Split"
            icon={Columns2}
            onSelect={(v) => update({ layout: v, camsVisible: true })}
          />
        </div>
      </div>

      <button
        type="button"
        onClick={() => update({ camsVisible: !prefs.camsVisible })}
        disabled={!canShowCams}
        className={clsx(
          "w-full flex items-center justify-between rounded-lg px-2 py-1.5 transition",
          canShowCams
            ? "bg-white/5 hover:bg-white/10"
            : "bg-white/5 opacity-40 cursor-not-allowed",
        )}
      >
        <span className="flex items-center gap-2">
          {prefs.camsVisible ? <Eye size={13} /> : <EyeOff size={13} />}
          Show cameras
        </span>
        <span
          className={clsx(
            "w-7 h-4 rounded-full relative transition",
            prefs.camsVisible ? "bg-violet-500" : "bg-white/15",
          )}
        >
          <span
            className={clsx(
              "absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all",
              prefs.camsVisible ? "left-3.5" : "left-0.5",
            )}
          />
        </span>
      </button>

      {isTheater && prefs.camsVisible && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-1.5">
            Cam size
          </div>
          <div className="grid grid-cols-3 gap-1">
            {(["sm", "md", "lg"] as CamSize[]).map((s) => (
              <SegBtn
                key={s}
                active={prefs.camSize === s}
                onClick={() => update({ camSize: s })}
              >
                {s === "sm" ? "Small" : s === "md" ? "Medium" : "Large"}
              </SegBtn>
            ))}
          </div>
        </div>
      )}

      {isTheater && prefs.camsVisible && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-1.5">
            Cam corner
          </div>
          <div className="grid grid-cols-2 gap-1 max-w-[160px] mx-auto">
            <CornerBtn
              active={prefs.camCorner === "tl"}
              icon={ArrowUpLeft}
              onClick={() => update({ camCorner: "tl", camOffset: null })}
            />
            <CornerBtn
              active={prefs.camCorner === "tr"}
              icon={ArrowUpRight}
              onClick={() => update({ camCorner: "tr", camOffset: null })}
            />
            <CornerBtn
              active={prefs.camCorner === "bl"}
              icon={ArrowDownLeft}
              onClick={() => update({ camCorner: "bl", camOffset: null })}
            />
            <CornerBtn
              active={prefs.camCorner === "br"}
              icon={ArrowDownRight}
              onClick={() => update({ camCorner: "br", camOffset: null })}
            />
          </div>
        </div>
      )}

      <div>
        <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-1.5">
          Screen fit
        </div>
        <div className="grid grid-cols-2 gap-1">
          {(["contain", "cover"] as ScreenFit[]).map((f) => (
            <SegBtn
              key={f}
              active={prefs.screenFit === f}
              onClick={() => update({ screenFit: f })}
            >
              {f === "contain" ? "Letterbox" : "Fill"}
            </SegBtn>
          ))}
        </div>
      </div>

      <button
        type="button"
        onClick={onToggleFullscreen}
        className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white font-medium hover:opacity-90 transition"
      >
        {isFullscreen ? (
          <>
            <Minimize2 size={13} /> Exit fullscreen
          </>
        ) : (
          <>
            <Maximize2 size={13} /> Fullscreen viewport
          </>
        )}
      </button>

      {isTheater && prefs.camsVisible && (
        <div className="text-[10px] text-neutral-500 leading-relaxed pt-1 border-t border-white/5">
          Tip: drag cam tiles to move them. They snap to the nearest corner
          on release.
        </div>
      )}
    </div>,
    document.body,
  );
}

function LayoutPick({
  current,
  value,
  label,
  icon: Icon,
  onSelect,
}: {
  current: LayoutMode;
  value: LayoutMode;
  label: string;
  icon: LucideIcon;
  onSelect: (v: LayoutMode) => void;
}) {
  const active = current === value;
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      className={clsx(
        "flex flex-col items-center gap-1 px-1.5 py-2 rounded-md transition",
        active
          ? "bg-violet-500/20 ring-1 ring-violet-400/40 text-violet-100"
          : "bg-white/5 hover:bg-white/10 text-neutral-300",
      )}
    >
      <Icon size={16} />
      <span className="text-[10px]">{label}</span>
    </button>
  );
}

function SegBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "px-2 py-1.5 rounded-md text-[11px] transition",
        active
          ? "bg-violet-500/20 ring-1 ring-violet-400/40 text-violet-100"
          : "bg-white/5 hover:bg-white/10 text-neutral-300",
      )}
    >
      {children}
    </button>
  );
}

function CornerBtn({
  active,
  icon: Icon,
  onClick,
}: {
  active: boolean;
  icon: LucideIcon;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "aspect-square grid place-items-center rounded-md transition",
        active
          ? "bg-violet-500/20 ring-1 ring-violet-400/40 text-violet-100"
          : "bg-white/5 hover:bg-white/10 text-neutral-300",
      )}
    >
      <Icon size={16} />
    </button>
  );
}
