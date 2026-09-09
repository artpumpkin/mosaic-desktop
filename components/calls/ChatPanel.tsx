"use client";
import { forwardRef, useEffect, useRef, useState } from "react";
import { Send, Smile, Image as ImageIcon, ChevronRight } from "lucide-react";
import clsx from "clsx";
import type { ChatMessage, ChatPayload } from "@/lib/calls/types";
import { displayName, type Profile } from "@/lib/calls/profile";
import EmojiPicker from "./EmojiPicker";
import GifPicker from "./GifPicker";

export default function ChatPanel({
  messages,
  onSend,
  collapsed,
  onToggleCollapse,
  myProfile,
  peerProfile,
}: {
  messages: ChatMessage[];
  onSend: (payload: ChatPayload) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  myProfile?: Profile;
  peerProfile?: Profile | null;
}) {
  const peerName = displayName(peerProfile ?? null, "Peer");
  const myColor = myProfile?.color;
  const peerColor = peerProfile?.color;
  const [draft, setDraft] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [gifOpen, setGifOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const emojiBtnRef = useRef<HTMLButtonElement>(null);
  const gifBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    // Only auto-scroll if user is already near the bottom.
    const nearBottom = el.scrollHeight - el.clientHeight - el.scrollTop < 120;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const send = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onSend({ kind: "text", text: trimmed });
    setDraft("");
  };

  const insertEmoji = (e: string) => {
    const el = inputRef.current;
    if (!el) {
      setDraft((d) => d + e);
    } else {
      const start = el.selectionStart ?? draft.length;
      const end = el.selectionEnd ?? draft.length;
      const next = draft.slice(0, start) + e + draft.slice(end);
      setDraft(next);
      requestAnimationFrame(() => {
        el.focus();
        el.selectionStart = el.selectionEnd = start + e.length;
      });
    }
    setEmojiOpen(false);
  };

  const pickGif = (gifUrl: string) => {
    onSend({ kind: "gif", gifUrl });
    setGifOpen(false);
  };

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onToggleCollapse}
        aria-label="Open chat"
        className="grid place-items-center w-9 self-stretch rounded-xl bg-white/[0.04] hover:bg-white/10 border border-white/10 transition"
      >
        <ChevronRight size={16} className="rotate-180" />
      </button>
    );
  }

  return (
    <aside className="flex flex-col w-72 shrink-0 rounded-xl bg-black/30 border border-white/10 overflow-hidden">
      <header className="flex items-center justify-between px-3 py-2 border-b border-white/5">
        <span className="text-xs font-semibold tracking-wide">Chat</span>
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label="Hide chat"
          className="grid place-items-center w-6 h-6 rounded-md hover:bg-white/10 transition"
        >
          <ChevronRight size={14} />
        </button>
      </header>

      <div
        ref={listRef}
        className="flex-1 overflow-y-auto p-3 space-y-2 min-h-0"
      >
        {messages.length === 0 && (
          <div className="text-[11px] text-neutral-500 text-center pt-4">
            No messages yet. Say hi.
          </div>
        )}
        {messages.map((m) => (
          <MessageBubble
            key={m.id}
            msg={m}
            peerName={peerName}
            peerColor={peerColor}
            myColor={myColor}
          />
        ))}
      </div>

      <div className="relative px-2 pt-2 pb-2 border-t border-white/5">
        {emojiOpen && emojiBtnRef.current && (
          <EmojiPicker
            anchor={emojiBtnRef.current}
            onSelect={insertEmoji}
            onClose={() => setEmojiOpen(false)}
          />
        )}
        {gifOpen && gifBtnRef.current && (
          <GifPicker
            anchor={gifBtnRef.current}
            onPick={pickGif}
            onClose={() => setGifOpen(false)}
          />
        )}
        <textarea
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          rows={2}
          placeholder="Type a message…"
          className="w-full resize-none px-2 py-1.5 rounded-md bg-white/5 border border-white/10 text-xs placeholder:text-neutral-600 focus:outline-none focus:border-violet-400/40"
        />
        <div className="flex items-center justify-between mt-1.5">
          <div className="flex items-center gap-1">
            <IconBtn
              ref={emojiBtnRef}
              label="Emoji"
              icon={Smile}
              onClick={() => {
                setGifOpen(false);
                setEmojiOpen((v) => !v);
              }}
            />
            <IconBtn
              ref={gifBtnRef}
              label="GIF"
              icon={ImageIcon}
              onClick={() => {
                setEmojiOpen(false);
                setGifOpen((v) => !v);
              }}
            />
          </div>
          <button
            type="button"
            onClick={send}
            disabled={!draft.trim()}
            aria-label="Send"
            className={clsx(
              "grid place-items-center w-7 h-7 rounded-md transition",
              draft.trim()
                ? "bg-violet-500 hover:bg-violet-400 text-white"
                : "bg-white/5 text-neutral-600 cursor-not-allowed",
            )}
          >
            <Send size={13} />
          </button>
        </div>
      </div>
    </aside>
  );
}

const IconBtn = forwardRef<
  HTMLButtonElement,
  { icon: typeof Send; label: string; onClick: () => void }
>(function IconBtn({ icon: Icon, label, onClick }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="grid place-items-center w-7 h-7 rounded-md hover:bg-white/10 text-neutral-300 transition"
    >
      <Icon size={14} />
    </button>
  );
});

function MessageBubble({
  msg,
  peerName,
  peerColor,
  myColor,
}: {
  msg: ChatMessage;
  peerName: string;
  peerColor?: string;
  myColor?: string;
}) {
  const isMe = msg.from === "me";
  const accent = isMe ? myColor : peerColor;
  const meStyle = isMe && myColor
    ? { background: myColor, color: "#111" }
    : undefined;
  return (
    <div
      className={clsx(
        "flex flex-col gap-0.5",
        isMe ? "items-end" : "items-start",
      )}
    >
      {!isMe && (
        <div className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-neutral-400 px-1">
          {accent && (
            <span
              className="inline-block w-1.5 h-1.5 rounded-full"
              style={{ background: accent }}
            />
          )}
          {peerName}
        </div>
      )}
      <div
        className={clsx(
          "max-w-[85%] rounded-2xl px-3 py-1.5 text-xs break-words",
          isMe
            ? "rounded-br-sm"
            : "bg-white/10 text-neutral-100 rounded-bl-sm",
          isMe && !myColor &&
            "bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white",
        )}
        style={meStyle}
      >
        {msg.kind === "text" ? (
          msg.text
        ) : (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={msg.gifUrl}
            alt="GIF"
            className="rounded-md max-w-full h-auto"
          />
        )}
      </div>
    </div>
  );
}
