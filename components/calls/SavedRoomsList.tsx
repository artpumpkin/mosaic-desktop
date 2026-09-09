"use client";
import { useState } from "react";
import clsx from "clsx";
import { Bookmark, Pencil, Trash2, PhoneCall, Check, X } from "lucide-react";
import type { SavedRoom } from "@/lib/calls/savedRooms";

export default function SavedRoomsList({
  rooms,
  onJoin,
  onRename,
  onRemove,
}: {
  rooms: SavedRoom[];
  onJoin: (code: string) => void;
  onRename: (id: string, name: string) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/30 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Bookmark size={14} className="text-neutral-400" />
        <h2 className="text-sm font-semibold tracking-tight">Saved rooms</h2>
      </div>
      {rooms.length === 0 ? (
        <p className="text-[11px] text-neutral-500 leading-relaxed">
          No saved rooms yet. While you&apos;re in a call, click the bookmark
          icon next to the room code to save it here for quick rejoin.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {rooms.map((r) => (
            <SavedRoomRow
              key={r.id}
              room={r}
              onJoin={onJoin}
              onRename={onRename}
              onRemove={onRemove}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function SavedRoomRow({
  room,
  onJoin,
  onRename,
  onRemove,
}: {
  room: SavedRoom;
  onJoin: (code: string) => void;
  onRename: (id: string, name: string) => void;
  onRemove: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(room.name);

  const commit = () => {
    const v = draft.trim();
    if (v && v !== room.name) onRename(room.id, v);
    setEditing(false);
  };

  return (
    <li className="group flex items-center gap-2 rounded-lg bg-white/[0.04] hover:bg-white/[0.07] px-2.5 py-1.5 transition">
      {editing ? (
        <>
          <input
            autoFocus
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, 48))}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") {
                setDraft(room.name);
                setEditing(false);
              }
            }}
            className="flex-1 min-w-0 px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-xs focus:outline-none focus:border-violet-400/40"
          />
          <IconBtn label="Save" icon={Check} onClick={commit} />
          <IconBtn
            label="Cancel"
            icon={X}
            onClick={() => {
              setDraft(room.name);
              setEditing(false);
            }}
          />
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={() => onJoin(room.code)}
            className="flex-1 min-w-0 flex items-center gap-2 text-left"
          >
            <span className="text-xs font-medium truncate">{room.name}</span>
            <code className="shrink-0 text-[10px] text-neutral-500 font-mono">
              {room.code}
            </code>
          </button>
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition">
            <IconBtn
              label="Rename"
              icon={Pencil}
              onClick={() => setEditing(true)}
            />
            <IconBtn
              label="Delete"
              icon={Trash2}
              onClick={() => onRemove(room.id)}
            />
          </div>
          <IconBtn
            label="Join"
            icon={PhoneCall}
            onClick={() => onJoin(room.code)}
            highlight
          />
        </>
      )}
    </li>
  );
}

function IconBtn({
  icon: Icon,
  label,
  onClick,
  highlight,
}: {
  icon: typeof Pencil;
  label: string;
  onClick: () => void;
  highlight?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={clsx(
        "grid place-items-center w-6 h-6 rounded-md transition",
        highlight
          ? "bg-violet-500/20 hover:bg-violet-500/30 text-violet-200"
          : "hover:bg-white/10 text-neutral-400 hover:text-neutral-100",
      )}
    >
      <Icon size={12} />
    </button>
  );
}
