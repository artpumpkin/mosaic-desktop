import { fetch } from "@tauri-apps/plugin-http";
import type { RawBalance } from "./binance";

const BASE = "https://www.okx.com";
const DUST = 0.0001;

async function hmacSha256Base64(secret: string, message: string): Promise<string> {
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
  let bin = "";
  for (let i = 0; i < sig.length; i++) bin += String.fromCharCode(sig[i]);
  return btoa(bin);
}

export async function fetchOkxBalances(
  apiKey: string,
  apiSecret: string,
  passphrase: string,
): Promise<RawBalance[]> {
  const path = "/api/v5/account/balance";
  const method = "GET";
  const timestamp = new Date().toISOString();
  const signature = await hmacSha256Base64(apiSecret, timestamp + method + path + "");

  const res = await fetch(BASE + path, {
    headers: {
      "OK-ACCESS-KEY": apiKey,
      "OK-ACCESS-SIGN": signature,
      "OK-ACCESS-TIMESTAMP": timestamp,
      "OK-ACCESS-PASSPHRASE": passphrase,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OKX ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    code: string;
    msg: string;
    data: { details: { ccy: string; eq: string; cashBal: string }[] }[];
  };
  if (data.code !== "0") {
    throw new Error(`OKX error ${data.code}: ${data.msg}`);
  }
  const out: RawBalance[] = [];
  for (const acct of data.data ?? []) {
    for (const d of acct.details ?? []) {
      const amount = parseFloat(d.eq || d.cashBal || "0");
      if (amount >= DUST) out.push({ asset: d.ccy, amount });
    }
  }
  return out;
}
