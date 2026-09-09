"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Picker from "@emoji-mart/react";
import data from "@emoji-mart/data";

type EmojiSelectEvent = { native: string };

const PICKER_W = 352;
const PICKER_H = 432;
const GAP = 8;
const MARGIN = 8;

function positionFor(rect: DOMRect): { left: number; top: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // anchor above the trigger, right-aligned to it
  let left = rect.right - PICKER_W;
  left = Math.min(Math.max(MARGIN, left), vw - PICKER_W - MARGIN);
  let top = rect.top - GAP - PICKER_H;
  if (top < MARGIN) top = Math.min(rect.bottom + GAP, vh - PICKER_H - MARGIN);
  return { left, top };
}

export default function EmojiPicker({
  anchor,
  onSelect,
  onClose,
}: {
  anchor: HTMLElement;
  onSelect: (emoji: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(() => positionFor(anchor.getBoundingClientRect()));

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

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={ref}
      style={{ position: "fixed", left: pos.left, top: pos.top, zIndex: 100 }}
      className="shadow-2xl rounded-lg overflow-hidden"
    >
      <Picker
        data={data}
        onEmojiSelect={(e: EmojiSelectEvent) => onSelect(e.native)}
        theme="dark"
        previewPosition="none"
        skinTonePosition="none"
        navPosition="bottom"
        perLine={8}
      />
    </div>,
    document.body,
  );
}
