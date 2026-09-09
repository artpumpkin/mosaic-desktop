export type WeightPoint = { recordedAt: string; weightKg: number };
export type ChartPoint = {
  ts: number;
  date: string;
  weight: number | null;
  ma5: number | null;
  ma10: number | null;
};

const DAY_MS = 86_400_000;

function startOfDay(date: Date): number {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Reduce raw entries to one value per calendar day (the day's average) so that
 * a moving average actually reflects "days" not "entries".
 */
export function dailyAverages(entries: WeightPoint[]): Map<number, number> {
  const buckets = new Map<number, { sum: number; n: number }>();
  for (const e of entries) {
    const day = startOfDay(new Date(e.recordedAt));
    const b = buckets.get(day) ?? { sum: 0, n: 0 };
    b.sum += e.weightKg;
    b.n += 1;
    buckets.set(day, b);
  }
  const out = new Map<number, number>();
  for (const [k, v] of buckets) out.set(k, v.sum / v.n);
  return out;
}

/**
 * Trailing simple moving average over the last `window` calendar days
 * (including the current day). Returns null when there isn't enough data
 * in the lookback window.
 */
export function buildChartSeries(
  entries: WeightPoint[],
  rangeDays: number | null = null,
): ChartPoint[] {
  if (entries.length === 0) return [];
  const daily = dailyAverages(entries);
  const sortedDays = Array.from(daily.keys()).sort((a, b) => a - b);
  const firstDay = sortedDays[0];
  const lastDay = sortedDays[sortedDays.length - 1];

  const cutoff = rangeDays ? lastDay - (rangeDays - 1) * DAY_MS : firstDay;
  const startDay = Math.max(firstDay, cutoff);

  const points: ChartPoint[] = [];
  for (let d = startDay; d <= lastDay; d += DAY_MS) {
    const weight = daily.get(d) ?? null;
    points.push({
      ts: d,
      date: new Date(d).toISOString().slice(0, 10),
      weight,
      ma5: trailingAverage(daily, d, 5),
      ma10: trailingAverage(daily, d, 10),
    });
  }
  return points;
}

function trailingAverage(
  daily: Map<number, number>,
  endDay: number,
  windowDays: number,
): number | null {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < windowDays; i++) {
    const d = endDay - i * DAY_MS;
    const v = daily.get(d);
    if (v !== undefined) {
      sum += v;
      n += 1;
    }
  }
  if (n === 0) return null;
  return sum / n;
}

/**
 * Average weight over the most recent N calendar days where entries exist.
 */
export function recentAverage(entries: WeightPoint[], days: number): number | null {
  if (entries.length === 0) return null;
  const daily = dailyAverages(entries);
  const lastDay = Math.max(...daily.keys());
  return trailingAverage(daily, lastDay, days);
}

export function latestEntry(entries: WeightPoint[]): WeightPoint | null {
  if (entries.length === 0) return null;
  return entries.reduce((best, e) =>
    new Date(e.recordedAt) > new Date(best.recordedAt) ? e : best,
  );
}
