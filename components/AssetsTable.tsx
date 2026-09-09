"use client";
import { useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { fmtCrypto, fmtBase, type FxTable } from "@/lib/format";
import Sensitive from "@/components/Sensitive";

type Row = {
  id: number;
  assetSymbol: string;
  amount: number;
  priceUsd: number;
  valueMad: number;
};

const THRESHOLD = 0.01;
const STORAGE_KEY = "ft-show-zero-assets";

export default function AssetsTable({
  rows,
  emptyText,
  base,
  fx,
}: {
  rows: Row[];
  emptyText: string;
  base: string;
  fx: FxTable;
}) {
  const [showAll, setShowAll] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "1") setShowAll(true);
    } catch {
      /* ignore */
    }
    setHydrated(true);
  }, []);

  const toggle = () => {
    setShowAll((v) => {
      const next = !v;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const sorted = [...rows].sort((a, b) => b.valueMad - a.valueMad);
  const visible = showAll ? sorted : sorted.filter((r) => r.valueMad >= THRESHOLD);
  const hiddenCount = sorted.length - visible.length;

  // Before hydration, render the default (hidden) view to match server output and
  // avoid a flash of all-rows on first paint.
  const showToggle =
    hydrated && rows.length > 0 && (showAll || hiddenCount > 0);

  return (
    <>
      {showToggle && (
        <div className="px-5 py-2 flex justify-end border-b border-white/5 text-xs">
          <button
            type="button"
            onClick={toggle}
            className={
              showAll
                ? "flex items-center gap-1.5 text-violet-300 hover:text-violet-200 transition-colors"
                : "flex items-center gap-1.5 text-neutral-500 hover:text-violet-300 transition-colors"
            }
          >
            {showAll ? (
              <>
                <EyeOff size={13} /> Hide zero-value
              </>
            ) : (
              <>
                <Eye size={13} /> Show {hiddenCount} zero-value{" "}
                {hiddenCount === 1 ? "asset" : "assets"}
              </>
            )}
          </button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wider text-neutral-500 border-b border-white/5">
            <tr>
              <th className="px-5 py-3">Asset</th>
              <th className="px-5 py-3 text-right">Amount</th>
              <th className="px-5 py-3 text-right">Price (USD)</th>
              <th className="px-5 py-3 text-right">Value ({base})</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td
                  colSpan={4}
                  className="px-5 py-6 text-center text-sm text-neutral-500"
                >
                  {rows.length === 0 ? emptyText : "All assets are zero-value. Click “Show all” above to reveal them."}
                </td>
              </tr>
            )}
            {visible.map((r) => (
              <tr
                key={r.id}
                className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02] transition-colors"
              >
                <td className="px-5 py-2.5 font-medium">{r.assetSymbol}</td>
                <td className="px-5 py-2.5 text-right font-mono tabular-nums">
                  <Sensitive>{fmtCrypto(r.amount)}</Sensitive>
                </td>
                <td className="px-5 py-2.5 text-right text-neutral-400 tabular-nums">
                  $
                  {r.priceUsd.toLocaleString("en-US", {
                    maximumFractionDigits: 4,
                  })}
                </td>
                <td className="px-5 py-2.5 text-right tabular-nums">
                  <Sensitive>{fmtBase(r.valueMad, base, fx, true)}</Sensitive>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
