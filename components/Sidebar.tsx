"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import clsx from "clsx";
import {
  LayoutDashboard,
  Landmark,
  Wallet,
  CandlestickChart,
  Coins,
  TrendingDown,
  TrendingUp,
  HandCoins,
  Settings,
  Menu,
  X,
  Scale,
  Flame,
  Activity,
  UserCog,
  Gem,
  Hourglass,
  KeyRound,
  CalendarDays,
  RefreshCw,
  SlidersHorizontal,
  PhoneCall,
  Tv,
  Film,
  BookOpen,
  Library,
  Sparkles,
  Headphones,
  Wand2,
  Trash2,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";
import ThemeToggle from "@/components/ThemeToggle";
import PrivacyToggle from "@/components/PrivacyToggle";
import { useAppLayout } from "@/lib/appLayout";

// Per-entry tint — matches Apple's System Settings idiom where each row icon
// has its own brand color. We keep colors moderately saturated so they read
// well on the dark sidebar surface.
type NavEntry = {
  href: string;
  label: string;
  icon: LucideIcon;
  tint: string;
};

type NavSection = {
  section: string;
  entries: NavEntry[];
};

const SECTIONS: NavSection[] = [
  {
    section: "Overview",
    entries: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard, tint: "bg-indigo-500" },
    ],
  },
  {
    section: "Finance",
    entries: [
      { href: "/finance", label: "Net worth", icon: CandlestickChart, tint: "bg-emerald-500" },
      { href: "/finance/banks", label: "Banks", icon: Landmark, tint: "bg-blue-500" },
      { href: "/finance/cash", label: "Cash", icon: Wallet, tint: "bg-green-500" },
      { href: "/finance/exchanges", label: "Exchanges", icon: CandlestickChart, tint: "bg-amber-500" },
      { href: "/finance/wallets", label: "ETH Wallets", icon: Coins, tint: "bg-violet-500" },
      { href: "/finance/assets", label: "Assets", icon: Gem, tint: "bg-pink-500" },
      { href: "/finance/expenses", label: "Expenses", icon: TrendingDown, tint: "bg-rose-500" },
      { href: "/finance/income", label: "Income", icon: TrendingUp, tint: "bg-emerald-500" },
      { href: "/finance/debts", label: "Debts", icon: HandCoins, tint: "bg-orange-500" },
    ],
  },
  {
    section: "Health",
    entries: [
      { href: "/health", label: "Overview", icon: Activity, tint: "bg-rose-500" },
      { href: "/health/weight", label: "Weight", icon: Scale, tint: "bg-blue-500" },
      { href: "/health/metabolism", label: "Metabolism", icon: Flame, tint: "bg-orange-500" },
      { href: "/health/fasting", label: "Fasting", icon: Hourglass, tint: "bg-amber-500" },
      { href: "/health/profile", label: "Profile", icon: UserCog, tint: "bg-slate-500" },
    ],
  },
  {
    section: "Rentals",
    entries: [
      { href: "/rentals", label: "Overview", icon: KeyRound, tint: "bg-amber-500" },
      { href: "/rentals/calendar", label: "Calendar", icon: CalendarDays, tint: "bg-red-500" },
      { href: "/rentals/turnovers", label: "Turnovers", icon: RefreshCw, tint: "bg-violet-500" },
      { href: "/rentals/settings", label: "Defaults", icon: SlidersHorizontal, tint: "bg-slate-500" },
    ],
  },
  {
    section: "Communicate",
    entries: [
      { href: "/calls", label: "Calls", icon: PhoneCall, tint: "bg-green-500" },
    ],
  },
  {
    section: "Media",
    entries: [
      { href: "/tv", label: "TV", icon: Tv, tint: "bg-violet-500" },
      { href: "/movies", label: "Movies", icon: Film, tint: "bg-rose-500" },
      { href: "/anime", label: "Anime", icon: Sparkles, tint: "bg-pink-500" },
      { href: "/manga", label: "Manga", icon: BookOpen, tint: "bg-amber-500" },
      { href: "/books", label: "Books", icon: Library, tint: "bg-sky-500" },
      { href: "/audio", label: "Audio", icon: Headphones, tint: "bg-teal-500" },
    ],
  },
  {
    section: "Tools",
    entries: [
      { href: "/optimize", label: "Optimize", icon: Wand2, tint: "bg-amber-500" },
    ],
  },
  {
    section: "System",
    entries: [
      { href: "/cleanup", label: "Cleanup", icon: Trash2, tint: "bg-teal-500" },
      { href: "/settings", label: "Settings", icon: Settings, tint: "bg-slate-500" },
    ],
  },
];

const COLLAPSE_STORAGE_KEY = "mosaic.sidebar.collapsed";

const TILE_GRADIENTS = [
  "from-violet-500 to-fuchsia-500",
  "from-emerald-400 to-cyan-400",
  "from-amber-400 to-orange-500",
  "from-indigo-500 to-violet-500",
];

function MosaicMark() {
  return (
    <span className="relative grid grid-cols-2 grid-rows-2 gap-[1px] w-7 h-7 rounded-lg overflow-hidden shadow-md shadow-violet-500/30">
      {TILE_GRADIENTS.map((g, i) => (
        <span
          key={i}
          className={clsx(
            "bg-gradient-to-br rounded-[2px]",
            g,
            i > 1 ? "opacity-70" : "",
          )}
        />
      ))}
    </span>
  );
}

export default function Sidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState<string>("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [hydrated, setHydrated] = useState(false);
  const { isFullWidth } = useAppLayout();

  useEffect(() => {
    import("@tauri-apps/api/app")
      .then((m) => m.getVersion())
      .then(setVersion)
      .catch(() => setVersion(""));
  }, []);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(COLLAPSE_STORAGE_KEY);
      if (stored) {
        const arr = JSON.parse(stored);
        if (Array.isArray(arr))
          setCollapsed(new Set(arr.filter((s) => typeof s === "string")));
      }
    } catch {
      /* ignore */
    }
    setHydrated(true);
  }, []);

  const toggleSection = (section: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      try {
        localStorage.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const normalize = (p: string) =>
    p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p;
  const here = normalize(pathname);
  const isActive = (href: string) => here === normalize(href);

  return (
    <>
      {!isFullWidth && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="md:hidden fixed top-4 left-4 z-40 grid place-items-center w-10 h-10 rounded-xl glass"
          aria-label="Open menu"
        >
          <Menu size={18} />
        </button>
      )}

      {open && !isFullWidth && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        />
      )}

      <aside
        aria-hidden={isFullWidth}
        className={clsx(
          "fixed inset-y-0 left-0 z-50 w-56 flex flex-col",
          "bg-[var(--sidebar-bg)] backdrop-blur-2xl",
          "border-r border-[var(--border-1)]",
          "transition-transform duration-300 ease-out",
          isFullWidth
            ? "-translate-x-full pointer-events-none"
            : open
              ? "translate-x-0"
              : "-translate-x-full md:translate-x-0",
        )}
      >
        {/* Brand row — compact, Apple-style identity strip. */}
        <div className="px-3.5 pt-4 pb-3 flex items-center justify-between">
          <Link
            href="/"
            className="flex items-center gap-2.5 min-w-0"
            onClick={() => setOpen(false)}
          >
            <MosaicMark />
            <div className="leading-tight min-w-0">
              <div className="font-semibold tracking-tight text-[14px]">Mosaic</div>
              <div className="text-[9.5px] uppercase tracking-[0.18em] text-neutral-500">
                Personal OS
              </div>
            </div>
          </Link>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="md:hidden p-1 rounded-md hover:bg-white/10"
            aria-label="Close menu"
          >
            <X size={16} />
          </button>
        </div>

        <nav className="px-2 flex-1 overflow-y-auto pb-2">
          {SECTIONS.map(({ section, entries }) => {
            const hasActive = entries.some((e) => isActive(e.href));
            const isCollapsed = hydrated && collapsed.has(section) && !hasActive;
            return (
              <div key={section} className="mt-3 first:mt-1">
                <button
                  type="button"
                  onClick={() => toggleSection(section)}
                  className="group w-full flex items-center gap-1 mb-0.5 px-2 py-0.5 text-[10px] font-semibold tracking-[0.08em] uppercase text-neutral-500 hover:text-neutral-300"
                  aria-expanded={!isCollapsed}
                >
                  <ChevronRight
                    size={9}
                    strokeWidth={3}
                    className={clsx(
                      "transition-transform duration-150 -ml-0.5",
                      !isCollapsed && "rotate-90",
                    )}
                  />
                  <span>{section}</span>
                </button>
                {!isCollapsed && (
                  <div className="space-y-px">
                    {entries.map((item) => (
                      <NavItem
                        key={item.href}
                        item={item}
                        active={isActive(item.href)}
                        onNav={() => setOpen(false)}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        <div className="px-3 py-2.5 border-t border-[var(--border-2)] flex items-center justify-between gap-2">
          <span className="font-mono text-[10px] text-neutral-600">
            {version ? `v${version}` : ""}
          </span>
          <div className="flex items-center gap-2">
            <PrivacyToggle />
            <ThemeToggle />
          </div>
        </div>
      </aside>
    </>
  );
}

function NavItem({
  item,
  active,
  onNav,
}: {
  item: NavEntry;
  active: boolean;
  onNav: () => void;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNav}
      className={clsx(
        "group flex items-center gap-2 px-2 py-1 rounded-md text-[13px] transition-colors",
        active
          ? "bg-white/[0.07] text-white"
          : "text-neutral-300 hover:bg-white/[0.035] hover:text-white",
      )}
    >
      <span
        className={clsx(
          "grid place-items-center w-[18px] h-[18px] rounded-[5px] shrink-0",
          item.tint,
          // Slight inner highlight so the tile reads as a real surface.
          "shadow-[inset_0_1px_0_rgba(255,255,255,0.18),inset_0_-1px_0_rgba(0,0,0,0.15)]",
        )}
      >
        <Icon size={11} strokeWidth={2.6} className="text-white" />
      </span>
      <span className="truncate">{item.label}</span>
    </Link>
  );
}
