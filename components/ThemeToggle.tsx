"use client";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

export default function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isDark = mounted && resolvedTheme === "dark";

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className="grid place-items-center w-8 h-8 rounded-lg border border-[var(--border-1)] bg-[var(--surface-1)] hover:bg-[var(--surface-1-hover)] hover:border-[var(--border-1-hover)] transition-colors"
    >
      {mounted ? (
        isDark ? (
          <Sun size={15} strokeWidth={2} />
        ) : (
          <Moon size={15} strokeWidth={2} />
        )
      ) : (
        <span className="w-[15px] h-[15px]" />
      )}
    </button>
  );
}
