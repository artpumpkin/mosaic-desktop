import { fetch } from "@tauri-apps/plugin-http";

const SYMBOL_TO_ID: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  USDT: "tether",
  USDC: "usd-coin",
  BNB: "binancecoin",
  SOL: "solana",
  XRP: "ripple",
  ADA: "cardano",
  DOGE: "dogecoin",
  TRX: "tron",
  AVAX: "avalanche-2",
  DOT: "polkadot",
  MATIC: "matic-network",
  POL: "polygon-ecosystem-token",
  LINK: "chainlink",
  LTC: "litecoin",
  ATOM: "cosmos",
  UNI: "uniswap",
  ARB: "arbitrum",
  OP: "optimism",
  NEAR: "near",
  APT: "aptos",
  SHIB: "shiba-inu",
  PEPE: "pepe",
  DAI: "dai",
  WBTC: "wrapped-bitcoin",
  WETH: "weth",
  STETH: "staked-ether",
  CAKE: "pancakeswap-token",
  TON: "the-open-network",
  FIL: "filecoin",
  XLM: "stellar",
  HBAR: "hedera-hashgraph",
  ALGO: "algorand",
  ICP: "internet-computer",
  AAVE: "aave",
  MKR: "maker",
  CRV: "curve-dao-token",
  SUSHI: "sushi",
  GRT: "the-graph",
  SAND: "the-sandbox",
  MANA: "decentraland",
  AXS: "axie-infinity",
  RNDR: "render-token",
  OKB: "okb",
  USDS: "usds",
  FDUSD: "first-digital-usd",
};

export function symbolToCoingeckoId(symbol: string): string | null {
  const upper = symbol.toUpperCase();
  return SYMBOL_TO_ID[upper] ?? null;
}

export async function getCryptoPricesUsd(
  symbols: string[],
): Promise<Record<string, number>> {
  const unique = Array.from(new Set(symbols.map((s) => s.toUpperCase())));
  const result: Record<string, number> = {};

  const stableLike = new Set(["USDT", "USDC", "DAI", "FDUSD", "USDS", "BUSD", "TUSD"]);
  const idMap = new Map<string, string>();
  for (const sym of unique) {
    if (stableLike.has(sym)) {
      result[sym] = 1;
      continue;
    }
    const id = symbolToCoingeckoId(sym);
    if (id) idMap.set(id, sym);
    else result[sym] = 0;
  }

  if (idMap.size === 0) return result;

  const ids = Array.from(idMap.keys()).join(",");
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids)}&vs_currencies=usd`;
  const res = await fetch(url);
  if (!res.ok) {
    for (const sym of idMap.values()) result[sym] = 0;
    return result;
  }
  const data = (await res.json()) as Record<string, { usd?: number }>;
  for (const [id, sym] of idMap) {
    result[sym] = data[id]?.usd ?? 0;
  }
  return result;
}
