// Tiny serial token-bucket rate limiter shared by manga connectors.
//
// MangaDex asks clients to stay under ~5 req/s on the API and ~40 req/min on
// the at-home (page image) endpoint; Comick sits behind Cloudflare and is
// happier when not hammered. Each call chains onto the previous one and
// sleeps just enough to keep a minimum gap between *starts*, so a burst (the
// chapter-feed pagination loop) is naturally smoothed.

type Opts = { perSec?: number; perMin?: number };

export function rateLimited(_label: string, opts: Opts) {
  const minGap = opts.perSec
    ? 1000 / opts.perSec
    : opts.perMin
      ? 60000 / opts.perMin
      : 0;
  // Resolves to the timestamp at which the previous call was allowed to start.
  let chain: Promise<number> = Promise.resolve(0);
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(async (lastStart) => {
      const wait = Math.max(0, lastStart + minGap - Date.now());
      if (wait) await new Promise((r) => setTimeout(r, wait));
      return Date.now();
    });
    // Next caller waits for this call's start stamp (serializes the queue).
    chain = run;
    return run.then(fn);
  };
}
