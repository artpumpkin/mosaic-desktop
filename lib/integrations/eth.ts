import { fetch } from "@tauri-apps/plugin-http";
import { getAlchemyApiKey } from "@/lib/settings";
import type { RawBalance } from "./binance";

async function alchemyUrl(): Promise<string> {
  const key = await getAlchemyApiKey();
  if (!key) {
    throw new Error(
      "Alchemy API key not set. Add it in Settings to fetch wallet balances.",
    );
  }
  return `https://eth-mainnet.g.alchemy.com/v2/${key}`;
}

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const url = await alchemyUrl();
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`Alchemy ${res.status}`);
  const data = (await res.json()) as { result?: T; error?: { message: string } };
  if (data.error) throw new Error(`Alchemy: ${data.error.message}`);
  return data.result as T;
}

export async function fetchEthHoldings(address: string): Promise<RawBalance[]> {
  const out: RawBalance[] = [];

  const ethHex = await rpc<string>("eth_getBalance", [address, "latest"]);
  const ethAmount = Number(BigInt(ethHex)) / 1e18;
  if (ethAmount > 0) out.push({ asset: "ETH", amount: ethAmount });

  const tokens = await rpc<{
    tokenBalances: { contractAddress: string; tokenBalance: string }[];
  }>("alchemy_getTokenBalances", [address, "erc20"]);

  const nonZero = tokens.tokenBalances.filter(
    (t) => t.tokenBalance && t.tokenBalance !== "0x0" && BigInt(t.tokenBalance) > 0n,
  );

  for (const t of nonZero) {
    try {
      const meta = await rpc<{ symbol: string | null; decimals: number | null }>(
        "alchemy_getTokenMetadata",
        [t.contractAddress],
      );
      const decimals = meta.decimals ?? 18;
      const symbol = (meta.symbol || "").toUpperCase();
      if (!symbol) continue;
      const raw = BigInt(t.tokenBalance);
      const amount = Number(raw) / Math.pow(10, decimals);
      if (amount > 0) out.push({ asset: symbol, amount });
    } catch {
      // skip tokens that fail metadata
    }
  }
  return out;
}
