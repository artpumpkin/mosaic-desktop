"use client";
import {
  Swords,
  Compass,
  Sparkles,
  Laugh,
  Fingerprint,
  Clapperboard,
  Drama,
  Users,
  Wand2,
  Landmark,
  Ghost,
  Music,
  Search,
  Heart,
  Rocket,
  Zap,
  Shield,
  Mountain,
  Bot,
  Brain,
  Coffee,
  Trophy,
  Moon,
  Film,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";
import clsx from "clsx";
import MediaRail from "@/components/browse/MediaRail";

/**
 * A single horizontal scroll-row of selectable genre cards — the visual
 * replacement for the old genre dropdown. Each card pairs a stable gradient + a
 * faded genre-icon watermark. Wraps the shared MediaRail so it inherits the
 * section's arrows, edge fades and header. Purely presentational (no fetch).
 */
export type GenreOption = { value: string; label: string };

type Props = {
  genres: GenreOption[];
  /** Currently-selected genre value, if any — gets a ring accent. */
  active?: string | null;
  onPick: (value: string) => void;
  title?: string;
};

// Per-label icon + gradient. Anything not listed falls back to a film reel on a
// neutral gradient, so unknown genres still render cleanly.
const STYLE: Record<string, { icon: LucideIcon; grad: string }> = {
  Action: { icon: Swords, grad: "from-rose-600/45 via-rose-500/20 to-orange-500/10" },
  Adventure: { icon: Compass, grad: "from-amber-500/45 via-orange-500/20 to-yellow-500/10" },
  Animation: { icon: Sparkles, grad: "from-fuchsia-500/45 via-purple-500/20 to-violet-500/10" },
  Comedy: { icon: Laugh, grad: "from-yellow-400/45 via-amber-500/20 to-orange-500/10" },
  Crime: { icon: Fingerprint, grad: "from-slate-500/45 via-slate-600/20 to-zinc-700/10" },
  Documentary: { icon: Clapperboard, grad: "from-teal-500/45 via-cyan-500/20 to-sky-500/10" },
  Drama: { icon: Drama, grad: "from-indigo-500/45 via-blue-500/20 to-sky-500/10" },
  Family: { icon: Users, grad: "from-emerald-500/45 via-green-500/20 to-lime-500/10" },
  Fantasy: { icon: Wand2, grad: "from-violet-500/45 via-fuchsia-500/20 to-purple-500/10" },
  History: { icon: Landmark, grad: "from-amber-600/45 via-yellow-700/20 to-stone-600/10" },
  Horror: { icon: Ghost, grad: "from-red-700/50 via-rose-900/25 to-neutral-800/10" },
  Music: { icon: Music, grad: "from-pink-500/45 via-rose-500/20 to-fuchsia-500/10" },
  Mystery: { icon: Search, grad: "from-cyan-600/45 via-sky-700/20 to-indigo-700/10" },
  Romance: { icon: Heart, grad: "from-rose-400/45 via-pink-500/20 to-red-500/10" },
  "Sci-Fi": { icon: Rocket, grad: "from-sky-500/45 via-cyan-500/20 to-blue-600/10" },
  Thriller: { icon: Zap, grad: "from-purple-600/45 via-indigo-600/20 to-slate-700/10" },
  War: { icon: Shield, grad: "from-stone-500/45 via-neutral-600/20 to-zinc-700/10" },
  Western: { icon: Mountain, grad: "from-orange-600/45 via-amber-700/20 to-stone-600/10" },
  // Anime-only genres
  Mecha: { icon: Bot, grad: "from-zinc-400/45 via-slate-500/20 to-cyan-600/10" },
  Psychological: { icon: Brain, grad: "from-fuchsia-600/45 via-purple-700/20 to-indigo-700/10" },
  "Slice of Life": { icon: Coffee, grad: "from-amber-400/45 via-orange-400/20 to-rose-400/10" },
  Sports: { icon: Trophy, grad: "from-lime-500/45 via-green-500/20 to-emerald-500/10" },
  Supernatural: { icon: Moon, grad: "from-indigo-600/45 via-violet-700/20 to-purple-800/10" },
};

const FALLBACK = { icon: Film, grad: "from-neutral-600/40 via-neutral-700/20 to-neutral-800/10" };

export default function GenreCards({
  genres,
  active,
  onPick,
  title = "Browse by genre",
}: Props) {
  return (
    <MediaRail
      title={title}
      items={genres}
      getKey={(g) => g.value}
      renderItem={(g) => {
        const { icon: Icon, grad } = STYLE[g.label] ?? FALLBACK;
        const isActive = active === g.value;
        return (
          <button
            type="button"
            onClick={() => onPick(g.value)}
            className={clsx(
              "group/card relative w-44 h-24 shrink-0 snap-start rounded-2xl overflow-hidden text-left",
              "border transition-[transform,box-shadow,border-color] duration-200",
              "hover:-translate-y-0.5 hover:shadow-xl hover:shadow-black/40",
              isActive
                ? "border-transparent ring-2 ring-violet-400/70"
                : "border-white/10 hover:border-white/20",
            )}
          >
            {/* Color wash */}
            <span aria-hidden className={clsx("absolute inset-0 bg-gradient-to-br", grad)} />
            {/* Dark base so light gradients still carry white text */}
            <span aria-hidden className="absolute inset-0 bg-neutral-950/30" />
            {/* Top sheen */}
            <span
              aria-hidden
              className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/10 to-transparent"
            />
            {/* Oversized icon watermark */}
            <Icon
              aria-hidden
              className="absolute -right-3 -bottom-3 h-20 w-20 text-white/15 transition-all duration-300 group-hover/card:scale-110 group-hover/card:text-white/25"
              strokeWidth={1.5}
            />
            {/* Small foreground icon chip */}
            <span
              aria-hidden
              className="absolute top-3 left-3 grid place-items-center h-8 w-8 rounded-lg bg-white/10 border border-white/15 text-white/90 backdrop-blur-sm transition-colors group-hover/card:bg-white/20"
            >
              <Icon className="h-4 w-4" strokeWidth={2} />
            </span>
            {/* Label */}
            <span className="absolute bottom-3 left-3 right-9 text-[14px] font-semibold text-white drop-shadow-sm truncate">
              {g.label}
            </span>
            {/* Hover chevron */}
            <ChevronRight
              aria-hidden
              className="absolute bottom-3 right-2.5 h-4 w-4 text-white/70 opacity-0 -translate-x-1 transition-all duration-200 group-hover/card:opacity-100 group-hover/card:translate-x-0"
            />
          </button>
        );
      }}
    />
  );
}
