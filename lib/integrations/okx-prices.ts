import { fetch } from "@tauri-apps/plugin-http";

const BASE = "https://www.okx.com";

export async function fetchOkxUsdPrices(): Promise<Record<string, number>> {
  const res = await fetch(`${BASE}/api/v5/market/tickers?instType=SPOT`);
  if (!res.ok) throw new Error(`OKX prices ${res.status}`);
  const data = (await res.json()) as {
    code: string;
    data: { instId: string; last: string }[];
  };
  if (data.code !== "0") throw new Error(`OKX prices: ${data.code}`);

  const STABLES = ["USDT", "USDC", "USD"];
  const out: Record<string, number> = {};
  for (const s of STABLES) out[s] = 1;

  for (const t of data.data ?? []) {
    const price = parseFloat(t.last);
    if (!price) continue;
    const [base, quote] = t.instId.split("-");
    if (!base || !quote) continue;
    if (STABLES.includes(quote) && out[base] === undefined) {
      out[base] = price;
    }
  }

  const btcUsd = out["BTC"];
  if (btcUsd) {
    for (const t of data.data ?? []) {
      const [base, quote] = t.instId.split("-");
      if (quote !== "BTC" || !base || out[base] !== undefined) continue;
      const price = parseFloat(t.last);
      if (price) out[base] = price * btcUsd;
    }
  }

  return out;
}
