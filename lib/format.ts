export type FxTable = Record<string, number>;

const madFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "MAD",
  maximumFractionDigits: 0,
});

const madFmt2 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "MAD",
  maximumFractionDigits: 2,
});

export function fmtMad(n: number, decimals = false): string {
  return (decimals ? madFmt2 : madFmt).format(Number.isFinite(n) ? n : 0);
}

export function fmtAmount(n: number, currency: string, decimals = 2): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: decimals,
    }).format(n);
  } catch {
    return `${n.toFixed(decimals)} ${currency}`;
  }
}

export function fmtCrypto(n: number): string {
  if (n === 0) return "0";
  if (n >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return n.toLocaleString("en-US", { maximumFractionDigits: 8 });
}

export function fmtDateTime(s?: string | null): string {
  if (!s) return "never";
  const d = new Date(s.includes("T") ? s : s + "Z");
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString();
}

/** Human-readable byte size, e.g. 1536 → "1.5 KB", 5e9 → "4.66 GB". */
export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

/** Convert an amount in any currency to MAD using an fx table. */
export function toMad(amount: number, currency: string, fx: FxTable): number {
  const upper = currency.toUpperCase();
  if (upper === "MAD") return amount;
  const rate = fx[upper];
  if (!rate) return 0;
  return amount * rate;
}

/** Convert a MAD amount to the given base currency using an fx table. */
export function madToBase(mad: number, base: string, fx: FxTable): number {
  const upper = base.toUpperCase();
  if (upper === "MAD") return mad;
  const rate = fx[upper];
  if (!rate) return mad;
  return mad / rate;
}

/** Convert a MAD amount to the base currency and format it. */
export function fmtBase(
  mad: number,
  base: string,
  fx: FxTable,
  decimals = false
): string {
  const v = madToBase(Number.isFinite(mad) ? mad : 0, base, fx);
  return fmtAmount(v, base.toUpperCase(), decimals ? 2 : 0);
}
