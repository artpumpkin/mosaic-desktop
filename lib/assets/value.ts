import { toMad, type FxTable } from "@/lib/format";
import { toTroyOz } from "@/lib/integrations/metals";
import { schema } from "@/lib/db/client";

export type AssetRow = typeof schema.assets.$inferSelect;

export function assetValueMad(row: AssetRow, fx: FxTable): number {
  if (row.category === "precious_metal") {
    if (
      row.metal &&
      row.quantity &&
      row.quantity > 0 &&
      row.unit &&
      row.pricePerOzUsd &&
      row.pricePerOzUsd > 0
    ) {
      const oz = toTroyOz(row.quantity, row.unit);
      const usd = oz * row.pricePerOzUsd;
      return toMad(usd, "USD", fx);
    }
    if (row.manualValue != null) {
      return toMad(row.manualValue, row.currency, fx);
    }
    return 0;
  }
  if (row.manualValue != null) {
    return toMad(row.manualValue, row.currency, fx);
  }
  return 0;
}
