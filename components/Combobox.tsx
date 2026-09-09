"use client";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Check, Search, X } from "lucide-react";
import clsx from "clsx";

export type ComboboxOption = {
  value: string;
  label: string;
  /** Optional prefix shown before the label (e.g. country flag emoji). */
  prefix?: string;
  /** Optional secondary text shown muted after the label (e.g. ISO code). */
  hint?: string;
};

type Props = {
  value?: string | null;
  onChange?: (next: string | null) => void;
  options: ComboboxOption[];
  placeholder?: string;
  /** Show the search input at the top of the listbox. Default true. */
  searchable?: boolean;
  /** Allow clearing the selection. Default true. */
  clearable?: boolean;
  /** Compact button width — applied to the trigger only. */
  className?: string;
  /** Max-height of the listbox in px. */
  maxHeight?: number;
  /** Icon shown at the start of the trigger — signals what the control does
   *  (e.g. a sort glyph) even when an option is selected. */
  leadingIcon?: ReactNode;
  /** Multi-select mode: pick several options; the listbox stays open on click.
   *  Drives `values` / `onValuesChange` instead of `value` / `onChange`. */
  multiple?: boolean;
  values?: string[];
  onValuesChange?: (next: string[]) => void;
  /** Noun for the "N <noun>" trigger label in multi mode (e.g. "countries"). */
  multiLabel?: string;
};

/**
 * Lightweight custom Combobox — modern alternative to native <select>.
 *
 * - Search input filters options by label
 * - Arrow keys / Enter / Esc keyboard navigation
 * - Click outside closes
 * - Auto-flips upwards when there's no space below
 * - Renders the listbox in a portal (fixed position) so it escapes any
 *   `overflow`/clipping ancestor — e.g. a toolbar with `overflow-x-auto`,
 *   which CSS promotes to `overflow-y: auto`, would otherwise clip the
 *   dropdown to the toolbar's height. Closes on scroll/resize to stay anchored.
 */
export default function Combobox({
  value,
  onChange,
  options,
  placeholder = "Select…",
  searchable = true,
  clearable = true,
  className,
  maxHeight = 320,
  leadingIcon,
  multiple = false,
  values,
  onValuesChange,
  multiLabel = "selected",
}: Props) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hoverIdx, setHoverIdx] = useState(0);
  // Fixed-position coordinates for the portaled listbox, anchored to the
  // trigger's viewport rect. Recomputed at open time.
  const [pos, setPos] = useState<{
    left: number;
    width: number;
    top?: number;
    bottom?: number;
  } | null>(null);
  // Lazy-cap initial row count. Rendering 250+ buttons on open synchronously
  // adds ~50–100ms of jank to the first paint; capping to 80 makes the open
  // feel instant, and we expand the cap on the next frame so users who scroll
  // see the rest.
  const [renderCap, setRenderCap] = useState(80);

  const selected = useMemo(
    () => options.find((o) => o.value === value) ?? null,
    [options, value],
  );
  const selectedSet = useMemo(() => new Set(values ?? []), [values]);
  // Whether the trigger reads as "filled" (drives text color + clear button).
  const hasValue = multiple ? selectedSet.size > 0 : !!selected;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        o.value.toLowerCase().includes(q),
    );
  }, [options, query]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      // The listbox is portaled outside rootRef, so check it too.
      if (!rootRef.current?.contains(t) && !popRef.current?.contains(t)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Close on scroll/resize — the portaled listbox is fixed-positioned and
  // anchored at open time, so it would otherwise drift away from the trigger.
  // The scroll listener is capture-phase on window, so it also fires for
  // scrolls *inside* the listbox itself — guard against that, or scrolling the
  // option list would close the dropdown and chain the wheel to the page.
  useEffect(() => {
    if (!open) return;
    const onScroll = (e: Event) => {
      if (popRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onResize = () => setOpen(false);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  // On open transition: focus the search input + expand the render cap on the
  // next frame. Flip direction and initial hover/query are already seeded at
  // click time (see `openCombobox`) so this effect avoids triggering an extra
  // render of the option list.
  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    // After paint, expand to render the rest of the list.
    const raf = requestAnimationFrame(() => setRenderCap(options.length));
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Seed state at click time so the first render of the listbox already has
  // the right query / hoverIdx / flip direction — no post-open re-render.
  const openCombobox = useCallback(() => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (rect) {
      const spaceBelow = window.innerHeight - rect.bottom;
      const flip = spaceBelow < Math.min(maxHeight, 240) && rect.top > spaceBelow;
      setPos({
        left: rect.left,
        width: rect.width,
        ...(flip
          ? { bottom: window.innerHeight - rect.top + 4 }
          : { top: rect.bottom + 4 }),
      });
    }
    setQuery("");
    setHoverIdx(Math.max(0, options.findIndex((o) => o.value === value)));
    setRenderCap(80);
    setOpen(true);
  }, [maxHeight, options, value]);

  // Keep the hovered row scrolled into view inside the listbox only.
  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    const el = list?.querySelector<HTMLElement>(
      `[data-cb-idx="${hoverIdx}"]`,
    );
    if (!el || !list) return;
    const er = el.getBoundingClientRect();
    const lr = list.getBoundingClientRect();
    if (er.top < lr.top) list.scrollTop += er.top - lr.top - 4;
    else if (er.bottom > lr.bottom) list.scrollTop += er.bottom - lr.bottom + 4;
  }, [hoverIdx, open]);

  const pick = useCallback(
    (next: string | null) => {
      if (multiple) {
        if (next == null) {
          onValuesChange?.([]);
          return;
        }
        const set = new Set(values ?? []);
        if (set.has(next)) set.delete(next);
        else set.add(next);
        onValuesChange?.([...set]);
        // Keep the listbox open so several options can be toggled in a row.
        return;
      }
      onChange?.(next);
      setOpen(false);
    },
    [multiple, values, onValuesChange, onChange],
  );

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHoverIdx((i) => Math.min(filtered.length - 1, i + 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHoverIdx((i) => Math.max(0, i - 1));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const opt = filtered[hoverIdx];
      if (opt) pick(opt.value);
      return;
    }
  };

  return (
    <div
      ref={rootRef}
      className={clsx("relative", className)}
      onKeyDown={onKey}
    >
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        onClick={() => (open ? setOpen(false) : openCombobox())}
        className={clsx(
          // Uniform border in every state so adjacent selects read identically
          // whether or not they hold a value — only the open state accents, and
          // the value/placeholder distinction is carried by text color alone.
          "w-full h-9 inline-flex items-center gap-2 px-2.5 rounded-lg border text-[12.5px] transition-colors",
          "bg-white/[0.04] hover:bg-white/[0.07]",
          open
            ? "border-violet-400/50 bg-white/[0.07]"
            : "border-white/10",
          hasValue ? "text-white" : "text-neutral-300",
        )}
      >
        {leadingIcon && (
          <span aria-hidden className="shrink-0 grid place-items-center text-neutral-400">
            {leadingIcon}
          </span>
        )}
        {!multiple && selected?.prefix && (
          <span aria-hidden className="shrink-0 text-base leading-none -my-0.5">
            {selected.prefix}
          </span>
        )}
        <span className="truncate flex-1 text-left">
          {multiple ? (
            selectedSet.size === 0 ? (
              <span className="text-neutral-500">{placeholder}</span>
            ) : (
              `${selectedSet.size} ${multiLabel}`
            )
          ) : selected ? (
            selected.label
          ) : (
            <span className="text-neutral-500">{placeholder}</span>
          )}
        </span>
        {clearable && hasValue && (
          <span
            role="button"
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation();
              pick(null);
            }}
            className="p-0.5 -mr-0.5 rounded text-neutral-500 hover:text-white hover:bg-white/10 cursor-pointer"
            aria-label="Clear selection"
          >
            <X size={12} />
          </span>
        )}
        <ChevronDown
          size={14}
          className={clsx(
            "shrink-0 text-neutral-500 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && pos && createPortal(
        <div
          ref={popRef}
          id={`${id}-list`}
          role="listbox"
          className={clsx(
            // Fully opaque background — no translucency, no backdrop-blur — so
            // the dropdown reads cleanly when it overflows over a video player
            // or other busy surfaces. Uses `--select-option-bg` so the color
            // tracks the light/dark theme.
            "fixed z-[1000] rounded-xl border border-white/10 shadow-2xl shadow-black/60 overflow-hidden flex flex-col",
          )}
          onKeyDown={onKey}
          style={{
            left: pos.left,
            top: pos.top,
            bottom: pos.bottom,
            // Decouple the dropdown width from the (often-narrow) trigger so
            // option labels actually have room to breathe. The dropdown still
            // anchors to the trigger's left edge and can extend further right.
            minWidth: `max(${pos.width}px, 14rem)`,
            backgroundColor: "var(--select-option-bg, #16161d)",
          }}
        >
          {searchable && (
            <div className="relative shrink-0 border-b border-white/10 bg-white/[0.02]">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 grid place-items-center w-4 h-4">
                <Search size={13} />
              </span>
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setHoverIdx(0);
                }}
                placeholder="Search…"
                // Borderless: it lives inside the dropdown frame already, so
                // an inner border created the "input inside a button" optical
                // illusion the user flagged. Bottom border on the parent
                // separates it from the option list cleanly.
                className="w-full h-9 !bg-transparent !border-0 !rounded-none !shadow-none !pl-9 !pr-3 text-[12.5px] placeholder:text-neutral-600 focus:!outline-none focus:!shadow-none focus:!ring-0"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          )}

          <div
            ref={listRef}
            // overscroll-contain stops the wheel from chaining to the page once
            // the list reaches its top/bottom edge.
            className="overflow-y-auto overscroll-contain py-1"
            style={{ maxHeight }}
          >
            {filtered.length === 0 ? (
              <div className="px-3 py-3 text-[12px] text-neutral-500 text-center">
                No matches
              </div>
            ) : (
              filtered.slice(0, renderCap).map((opt, i) => {
                const isSelected = multiple
                  ? selectedSet.has(opt.value)
                  : opt.value === value;
                const isHover = i === hoverIdx;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    data-cb-idx={i}
                    onMouseEnter={() => setHoverIdx(i)}
                    onClick={() => pick(opt.value)}
                    className={clsx(
                      "w-full text-left px-3 py-1.5 flex items-center gap-2 text-[12.5px] transition-colors",
                      isHover
                        ? "bg-violet-500/15 text-white"
                        : "text-neutral-300 hover:text-white",
                      isSelected && !isHover && "text-violet-200",
                    )}
                  >
                    {opt.prefix && (
                      <span aria-hidden className="shrink-0 text-base leading-none">
                        {opt.prefix}
                      </span>
                    )}
                    <span className="flex-1 truncate">{opt.label}</span>
                    {opt.hint && (
                      <span className="text-[10.5px] text-neutral-500 shrink-0">
                        {opt.hint}
                      </span>
                    )}
                    {isSelected && (
                      <Check size={13} className="text-violet-300 shrink-0" />
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
