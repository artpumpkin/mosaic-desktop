import { fetch } from "@tauri-apps/plugin-http";

export type RawBalance = { asset: string; amount: number };

const BASE = "https://api.binance.com";
const DUST = 0.0001;

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, enc.encode(message)),
  );
  let hex = "";
  for (let i = 0; i < sig.length; i++) {
    hex += sig[i].toString(16).padStart(2, "0");
  }
  return hex;
}

export async function fetchBinanceBalances(
  apiKey: string,
  apiSecret: string,
): Promise<RawBalance[]> {
  const timestamp = Date.now();
  const query = `timestamp=${timestamp}&recvWindow=10000`;
  const signature = await hmacSha256Hex(apiSecret, query);
  const url = `${BASE}/api/v3/account?${query}&signature=${signature}`;
  const res = await fetch(url, {
    headers: { "X-MBX-APIKEY": apiKey },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Binance ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    balances: { asset: string; free: string; locked: string }[];
  };
  const out: RawBalance[] = [];
  for (const b of data.balances) {
    const amount = parseFloat(b.free) + parseFloat(b.locked);
    if (amount >= DUST) out.push({ asset: b.asset, amount });
  }
  return out;
}
