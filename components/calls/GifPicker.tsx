"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Search, KeyRound, ExternalLink } from "lucide-react";
import {
  GiphyAuthError,
  getGiphyKey,
  searchGiphy,
  setGiphyKey,
  type GiphyResult,
} from "@/lib/calls/giphy";

const PICKER_W = 320;
const PICKER_H = 384;
const GAP = 8;
const MARGIN = 8;

function positionFor(rect: DOMRect): { left: number; top: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = rect.right - PICKER_W;
  left = Math.min(Math.max(MARGIN, left), vw - PICKER_W - MARGIN);
  let top = rect.top - GAP - PICKER_H;
  if (top < MARGIN) top = Math.min(rect.bottom + GAP, vh - PICKER_H - MARGIN);
  return { left, top };
}

export default function GifPicker({
  anchor,
  onPick,
  onClose,
}: {
  anchor: HTMLElement;
  onPick: (gifUrl: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(() => positionFor(anchor.getBoundingClientRect()));
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GiphyResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsKey, setNeedsKey] = useState(!getGiphyKey());
  const [keyDraft, setKeyDraft] = useState("");

  useEffect(() => {
    const reposition = () => setPos(positionFor(anchor.getBoundingClientRect()));
    reposition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
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

  useEffect(() => {
    if (needsKey) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const t = setTimeout(() => {
      searchGiphy(query)
        .then((r) => {
          if (!cancelled) setResults(r);
        })
        .catch((e) => {
          if (cancelled) return;
          if (e instanceof GiphyAuthError) {
            setNeedsKey(true);
            return;
          }
          setError(e instanceof Error ? e.message : "GIF fetch failed");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, needsKey]);

  const submitKey = () => {
    const trimmed = keyDraft.trim();
    if (!trimmed) return;
    setGiphyKey(trimmed);
    setKeyDraft("");
    setNeedsKey(false);
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={ref}
      style={{
        position: "fixed",
        left: pos.left,
        top: pos.top,
        zIndex: 100,
        width: PICKER_W,
        height: PICKER_H,
      }}
      className="flex flex-col rounded-lg bg-neutral-900 border border-white/10 shadow-2xl"
    >
      {needsKey ? (
        <div className="flex-1 flex flex-col justify-center gap-3 p-4">
          <div className="flex items-center gap-2 text-violet-200">
            <KeyRound size={14} />
            <span className="text-xs font-semibold">Giphy key required</span>
          </div>
          <p className="text-[11px] text-neutral-400 leading-relaxed">
            Giphy revoked the public demo key. Get your own free key (takes
            ~2 min):
          </p>
          <a
            href="https://developers.giphy.com/dashboard/"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[11px] text-violet-300 hover:text-violet-200"
          >
            developers.giphy.com/dashboard
            <ExternalLink size={10} />
          </a>
          <ol className="text-[10.5px] text-neutral-500 space-y-1 leading-relaxed list-decimal pl-4">
            <li>Sign in, click <em>Create an App</em></li>
            <li>Choose <em>API</em>, name it anything, agree to terms</li>
            <li>Copy the <em>API Key</em> shown</li>
          </ol>
          <input
            type="text"
            autoFocus
            value={keyDraft}
            onChange={(e) => setKeyDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitKey();
            }}
            placeholder="Paste your Giphy API key"
            className="w-full px-2 py-1.5 rounded-md bg-white/5 border border-white/10 text-xs font-mono focus:outline-none focus:border-violet-400/40"
          />
          <button
            type="button"
            onClick={submitKey}
            disabled={!keyDraft.trim()}
            className="w-full px-3 py-1.5 rounded-md bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white text-xs font-medium disabled:opacity-40 hover:opacity-90 transition"
          >
            Save key
          </button>
        </div>
      ) : (
        <>
      <div className="px-2 pt-2">
        <div className="flex items-center gap-1.5 rounded-md bg-white/5 border border-white/10 focus-within:border-violet-400/40 px-2 py-1.5">
          <Search
            size={13}
            className="text-neutral-500 shrink-0"
          />
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search GIFs…"
            className="flex-1 min-w-0 bg-transparent text-xs placeholder:text-neutral-500 focus:outline-none"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {loading && (
          <div className="h-full grid place-items-center">
            <Loader2 className="animate-spin text-neutral-500" size={20} />
          </div>
        )}
        {error && !loading && (
          <div className="text-[11px] text-red-400 p-2">{error}</div>
        )}
        {!loading && !error && (
          <div className="grid grid-cols-3 gap-1.5">
            {results.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => onPick(g.fullUrl)}
                aria-label={g.title}
                className="aspect-square rounded-md overflow-hidden bg-black/40 hover:ring-2 hover:ring-violet-400 transition"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={g.previewUrl}
                  alt={g.title}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="px-3 py-1.5 text-[9px] uppercase tracking-wider text-neutral-600 border-t border-white/5 flex items-center justify-between">
        <span>Powered by GIPHY</span>
        <button
          type="button"
          onClick={() => setNeedsKey(true)}
          className="text-neutral-500 hover:text-neutral-300 normal-case tracking-normal"
        >
          Change key
        </button>
      </div>
        </>
      )}
    </div>,
    document.body,
  );
}
