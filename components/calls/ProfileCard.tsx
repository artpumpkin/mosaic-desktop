"use client";
import { useEffect, useState } from "react";
import clsx from "clsx";
import { UserCircle2 } from "lucide-react";
import { PROFILE_COLORS, type Profile } from "@/lib/calls/profile";

export default function ProfileCard({
  profile,
  onChange,
}: {
  profile: Profile;
  onChange: (next: Profile) => void;
}) {
  // Local draft so typing doesn't write to localStorage on every keystroke.
  const [name, setName] = useState(profile.name);

  useEffect(() => {
    setName(profile.name);
  }, [profile.name]);

  const commit = () => {
    if (name !== profile.name) onChange({ ...profile, name });
  };

  return (
    <div className="rounded-xl border border-white/10 bg-black/30 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <UserCircle2 size={14} className="text-neutral-400" />
        <h2 className="text-sm font-semibold tracking-tight">Your profile</h2>
      </div>
      <p className="text-[11px] text-neutral-500 leading-relaxed">
        How you appear to the peer in the call — name and a colour for chat
        bubbles + tile labels.
      </p>
      <div className="flex items-center gap-3">
        <div
          className="grid place-items-center w-9 h-9 rounded-full shrink-0 font-semibold text-sm shadow-inner"
          style={{ background: profile.color, color: "#111" }}
        >
          {(name.trim()[0] ?? "?").toUpperCase()}
        </div>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, 24))}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            }
          }}
          placeholder="Your display name"
          className="flex-1 min-w-0 px-3 py-1.5 rounded-md bg-white/5 border border-white/10 text-xs placeholder:text-neutral-600 focus:outline-none focus:border-violet-400/40"
        />
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-1.5">
          Colour
        </div>
        <div className="flex flex-wrap gap-1.5">
          {PROFILE_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onChange({ ...profile, color: c })}
              aria-label={`Pick colour ${c}`}
              className={clsx(
                "w-6 h-6 rounded-full transition ring-offset-2 ring-offset-neutral-900",
                profile.color === c
                  ? "ring-2 ring-white"
                  : "hover:ring-2 hover:ring-white/40",
              )}
              style={{ background: c }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
