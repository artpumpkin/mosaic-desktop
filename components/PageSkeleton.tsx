"use client";
import GlassCard from "./GlassCard";

export default function PageSkeleton({
  lines = 4,
  loading = true,
}: {
  lines?: number;
  loading?: boolean;
}) {
  return (
    <div className="space-y-6 animate-pulse">
      <GlassCard className="h-32" />
      {Array.from({ length: lines }).map((_, i) => (
        <GlassCard key={i} className="h-24" />
      ))}
      {loading && (
        <p className="text-xs text-neutral-500 text-center">Loading…</p>
      )}
    </div>
  );
}
