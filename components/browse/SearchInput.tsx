"use client";
import { Search } from "lucide-react";
import clsx from "clsx";

/**
 * The toolbar search field shared by every section. `!pl-9`/`!pr-3`/`!py-1.5`
 * override globals.css's default input padding so the icon sits flush.
 */
type Props = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
};

export default function SearchInput({
  value,
  onChange,
  placeholder = "Search…",
  className,
}: Props) {
  return (
    <div className={clsx("relative flex-1 min-w-[180px] max-w-[420px]", className)}>
      <Search
        size={14}
        className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 pointer-events-none"
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full !h-9 !pl-9 !pr-3 !py-0 text-[12.5px] bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-400/30 focus:border-violet-400/40 placeholder:text-neutral-500"
      />
    </div>
  );
}
