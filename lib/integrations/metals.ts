import { fetch } from "@tauri-apps/plugin-http";

export type MetalSymbol = "XAU" | "XAG" | "XPT" | "XPD";

export const METAL_LABEL: Record<MetalSymbol, string> = {
  XAU: "Gold",
  XAG: "Silver",
  XPT: "Platinum",
  XPD: "Palladium",
};

const SUPPORTED: MetalSymbol[] = ["XAU", "XAG", "XPT", "XPD"];

const CACHE_TTL_MS = 60 * 60 * 1000;
let cache: { at: number; prices: Partial<Record<MetalSymbol, number>> } | null = null;

type GoldApiResponse = { price?: number };

async function fetchOne(symbol: MetalSymbol): Promise<number | null> {
  try {
    const res = await fetch(`https://api.gold-api.com/price/${symbol}`);
    if (!res.ok) return null;
    const data = (await res.json()) as GoldApiResponse;
    const price = typeof data?.price === "number" ? data.price : null;
    return price && price > 0 ? price : null;
  } catch {
    return null;
  }
}

export async function fetchMetalsUsdPerOz(
  force = false,
): Promise<Partial<Record<MetalSymbol, number>>> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.prices;
  }
  const results = await Promise.all(SUPPORTED.map((s) => fetchOne(s)));
  const out: Partial<Record<MetalSymbol, number>> = {};
  for (let i = 0; i < SUPPORTED.length; i++) {
    const price = results[i];
    if (price != null) out[SUPPORTED[i]] = price;
  }
  cache = { at: Date.now(), prices: out };
  return out;
}

const GRAMS_PER_TROY_OZ = 31.1034768;

export function toTroyOz(quantity: number, unit: "oz" | "g" | "kg"): number {
  if (unit === "oz") return quantity;
  if (unit === "g") return quantity / GRAMS_PER_TROY_OZ;
  return (quantity * 1000) / GRAMS_PER_TROY_OZ; // kg
}
