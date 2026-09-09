import { fetch } from "@tauri-apps/plugin-http";

const BASE = "https://api.binance.com";

export async function fetchBinanceUsdPrices(): Promise<Record<string, number>> {
  const res = await fetch(`${BASE}/api/v3/ticker/price`);
  if (!res.ok) throw new Error(`Binance prices ${res.status}`);
  const rows = (await res.json()) as { symbol: string; price: string }[];

  const STABLES = ["USDT", "USDC", "FDUSD", "BUSD", "TUSD", "USDS"];

  const out: Record<string, number> = {};
  for (const s of STABLES) out[s] = 1;

  for (const r of rows) {
    const price = parseFloat(r.price);
    if (!price) continue;
    for (const stable of STABLES) {
      if (r.symbol.endsWith(stable)) {
        const base = r.symbol.slice(0, -stable.length);
        if (!base) continue;
        if (out[base] === undefined) out[base] = price;
      }
    }
  }

  const btcUsd = out["BTC"];
  if (btcUsd) {
    for (const r of rows) {
      if (!r.symbol.endsWith("BTC")) continue;
      const base = r.symbol.slice(0, -3);
      if (!base || out[base] !== undefined) continue;
      const price = parseFloat(r.price);
      if (price) out[base] = price * btcUsd;
    }
  }

  return out;
}
