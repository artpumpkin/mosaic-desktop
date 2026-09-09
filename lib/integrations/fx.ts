import { fetch } from "@tauri-apps/plugin-http";
import { db, schema } from "@/lib/db/client";
import { desc, eq } from "drizzle-orm";
import type { FxTable } from "@/lib/format";

export { toMad } from "@/lib/format";
export type { FxTable } from "@/lib/format";

const CACHE_HOURS = 6;
const BASE = "MAD";
const SUPPORTED = ["USD", "EUR", "AED", "MAD"] as const;
export type Currency = (typeof SUPPORTED)[number] | string;

async function fetchFromApi(): Promise<Record<string, number>> {
  const res = await fetch("https://open.er-api.com/v6/latest/USD");
  if (!res.ok) throw new Error(`FX API ${res.status}`);
  const data = (await res.json()) as { rates: Record<string, number> };
  if (!data?.rates) throw new Error("FX API: no rates");
  return data.rates;
}

async function readCached(): Promise<FxTable | null> {
  const rows = await db
    .select()
    .from(schema.fxRates)
    .where(eq(schema.fxRates.base, BASE))
    .orderBy(desc(schema.fxRates.fetchedAt));
  if (!rows.length) return null;
  const newest = new Date(rows[0].fetchedAt + "Z").getTime();
  const ageHours = (Date.now() - newest) / 36e5;
  if (ageHours > CACHE_HOURS) return null;
  const table: FxTable = { MAD: 1 };
  for (const r of rows) {
    if (r.fetchedAt !== rows[0].fetchedAt) continue;
    table[r.quote] = r.rate;
  }
  return table;
}

async function writeCache(table: FxTable) {
  const fetchedAt = new Date().toISOString().slice(0, 19).replace("T", " ");
  await db.delete(schema.fxRates).where(eq(schema.fxRates.base, BASE));
  for (const [quote, rate] of Object.entries(table)) {
    await db.insert(schema.fxRates).values({ base: BASE, quote, rate, fetchedAt });
  }
}

export async function getFxToMad(force = false): Promise<FxTable> {
  if (!force) {
    const cached = await readCached();
    if (cached) return cached;
  }
  const usdRates = await fetchFromApi();
  const usdToMad = usdRates["MAD"];
  if (!usdToMad) throw new Error("FX API missing MAD rate");
  const table: FxTable = { MAD: 1 };
  for (const code of SUPPORTED) {
    if (code === "MAD") continue;
    const usdToCode = usdRates[code];
    if (!usdToCode) continue;
    table[code] = usdToMad / usdToCode;
  }
  await writeCache(table);
  return table;
}
