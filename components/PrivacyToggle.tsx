"use client";
import { Eye, EyeOff } from "lucide-react";
import { usePrivacy } from "@/lib/privacy";

export default function PrivacyToggle() {
  const { hidden, toggle } = usePrivacy();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={hidden ? "Show amounts" : "Hide amounts"}
      title={hidden ? "Show amounts" : "Hide amounts"}
      className="grid place-items-center w-8 h-8 rounded-lg border border-[var(--border-1)] bg-[var(--surface-1)] hover:bg-[var(--surface-1-hover)] hover:border-[var(--border-1-hover)] transition-colors"
    >
      {hidden ? (
        <EyeOff size={15} strokeWidth={2} />
      ) : (
        <Eye size={15} strokeWidth={2} />
      )}
    </button>
  );
}
