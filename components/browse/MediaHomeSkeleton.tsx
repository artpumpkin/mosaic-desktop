"use client";

// Loading placeholders that mirror the real browse-home layout (hero + rails)
// so the swap to live content is seamless. The `.skeleton` class (globals.css)
// supplies the shimmer sweep; a staggered fade-in adds a touch of life on first
// paint. Shared by the Anime + Movies sections.

function PosterSkeleton({ delay }: { delay: number }) {
  return (
    <div
      className="shrink-0 w-[160px] animate-fade-in-up"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="skeleton w-full aspect-[2/3] rounded-2xl" />
      <div className="skeleton h-3 rounded mt-2.5 w-[85%]" />
      <div className="skeleton h-2.5 rounded mt-1.5 w-[45%]" />
    </div>
  );
}

function RailSkeleton({ index }: { index: number }) {
  return (
    <section
      className="animate-fade-in-up"
      style={{ animationDelay: `${index * 90}ms` }}
    >
      <div className="skeleton h-5 w-44 rounded mb-3" />
      <div className="flex gap-4 overflow-hidden">
        {Array.from({ length: 8 }).map((_, i) => (
          <PosterSkeleton key={i} delay={index * 90 + i * 45} />
        ))}
      </div>
    </section>
  );
}

/**
 * Hero spotlight + a few poster rails — the browse-home loading state. Pass
 * `hero={false}` for sections that have no hero spotlight.
 */
export default function MediaHomeSkeleton({
  hero = true,
  rails = 3,
}: {
  hero?: boolean;
  rails?: number;
}) {
  return (
    <div className="space-y-10">
      {hero && (
        <div className="relative -mx-4 md:-mx-6 -mt-5 md:-mt-8 h-[clamp(380px,56vh,560px)] overflow-hidden animate-fade-in-up">
          <div className="skeleton absolute inset-0" />
          <div className="absolute inset-0 bg-gradient-to-t from-[var(--background)] via-[var(--background)]/55 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-r from-[var(--background)]/90 via-[var(--background)]/30 to-transparent" />
          <div className="relative h-full flex flex-col justify-end px-6 md:px-12 pb-8 md:pb-12 max-w-3xl gap-3">
            <div className="skeleton h-6 w-24 rounded-full" />
            <div className="skeleton h-12 md:h-16 w-3/4 rounded-lg" />
            <div className="skeleton h-3.5 w-56 rounded" />
            <div className="skeleton h-3 w-[34rem] max-w-full rounded mt-1" />
            <div className="flex gap-2.5 mt-3">
              <div className="skeleton h-12 w-32 rounded-full" />
              <div className="skeleton h-12 w-28 rounded-full" />
              <div className="skeleton h-12 w-12 rounded-full" />
            </div>
          </div>
        </div>
      )}

      {/* Rails */}
      <div className="space-y-10">
        {Array.from({ length: rails }).map((_, i) => (
          <RailSkeleton key={i} index={i} />
        ))}
      </div>
    </div>
  );
}

/** A responsive grid of poster placeholders — the browse / "See all" loading
 *  state, matching CatalogGridView's columns. */
export function PosterGridSkeleton({ count = 18 }: { count?: number }) {
  return (
    <div className="grid gap-5 md:gap-6 grid-cols-[repeat(auto-fill,minmax(150px,1fr))]">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="animate-fade-in-up"
          style={{ animationDelay: `${i * 30}ms` }}
        >
          <div className="skeleton w-full aspect-[2/3] rounded-2xl" />
          <div className="skeleton h-3 rounded mt-2.5 w-[85%]" />
          <div className="skeleton h-2.5 rounded mt-1.5 w-[45%]" />
        </div>
      ))}
    </div>
  );
}
