"use client";
import { desc } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { fmtBase, type FxTable } from "@/lib/format";
import { getFxToMad } from "@/lib/integrations/fx";
import { getBaseCurrency, type BaseCurrency } from "@/lib/settings";
import { useFinanceData } from "@/lib/query/useFinanceData";
import { useWide } from "@/lib/appLayout";
import { assetValueMad, type AssetRow as AssetRowType } from "@/lib/assets/value";
import GlassCard from "@/components/GlassCard";
import PageHeader from "@/components/PageHeader";
import PageSkeleton from "@/components/PageSkeleton";
import EmptyState from "@/components/EmptyState";
import ErrorCard from "@/components/ErrorCard";
import Sensitive from "@/components/Sensitive";
import {
  AssetCreateForm,
  AssetRefreshPricesButton,
  AssetRow,
  CATEGORY_LABEL,
  type AssetCategory,
  type AssetRowData,
} from "@/components/forms/AssetForms";
import { Gem } from "lucide-react";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-screen flex flex-col bg-[var(--background)] overflow-hidden">
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="w-full px-4 md:px-6 py-5 md:py-8 space-y-8">
          {children}
        </div>
      </div>
    </div>
  );
}

type PageData = {
  rows: AssetRowType[];
  fx: FxTable;
  base: BaseCurrency;
};

async function load(): Promise<PageData> {
  const [rows, fx, base] = await Promise.all([
    db.select().from(schema.assets).orderBy(desc(schema.assets.id)),
    getFxToMad().catch(() => ({ MAD: 1 }) as FxTable),
    getBaseCurrency(),
  ]);
  return { rows, fx, base };
}

const CATEGORY_ORDER: AssetCategory[] = [
  "precious_metal",
  "real_estate",
  "vehicle",
  "collectible",
  "other",
];

function toRowData(r: AssetRowType): AssetRowData {
  return {
    id: r.id,
    category: r.category,
    label: r.label,
    metal: r.metal,
    quantity: r.quantity,
    unit: r.unit,
    manualValue: r.manualValue,
    currency: r.currency,
    pricePerOzUsd: r.pricePerOzUsd,
    lastPricedAt: r.lastPricedAt,
    acquiredOn: r.acquiredOn,
    acquiredValue: r.acquiredValue,
    note: r.note,
    updatedAt: r.updatedAt,
  };
}

export default function AssetsPage() {
  useWide(true);
  const { data, error, reload } = useFinanceData(["assets"], load);

  if (error && !data)
    return (
      <Shell>
        <PageHeader
          icon={Gem}
          title="Assets"
          subtitle="Tangible holdings — metals, real estate, vehicles, collectibles."
        />
        <ErrorCard message={error} onRetry={reload} />
      </Shell>
    );

  if (!data)
    return (
      <Shell>
        <PageSkeleton />
      </Shell>
    );

  const { rows, fx, base } = data;
  const total = rows.reduce((s, r) => s + assetValueMad(r, fx), 0);
  const needsFx = rows.some(
    (r) =>
      (r.currency && r.currency !== "MAD") ||
      (r.category === "precious_metal" && r.pricePerOzUsd != null && r.pricePerOzUsd > 0),
  );
  const fxUnavailable = needsFx && !("USD" in fx);

  const groups = new Map<AssetCategory, AssetRowType[]>();
  for (const r of rows) {
    const arr = groups.get(r.category) ?? [];
    arr.push(r);
    groups.set(r.category, arr);
  }

  return (
    <Shell>
      <PageHeader
        icon={Gem}
        title="Assets"
        subtitle={
          <>
            Tangible holdings — metals, real estate, vehicles, collectibles.
            Total ≈ <Sensitive>{fmtBase(total, base, fx)}</Sensitive>
          </>
        }
        right={<AssetRefreshPricesButton />}
      />

      {fxUnavailable && (
        <p className="text-[11px] text-amber-300/80 max-w-prose">
          Live FX unavailable — showing approximate totals.
        </p>
      )}

      <GlassCard>
        <h2 className="font-medium mb-4">Add an asset</h2>
        <div className="max-w-5xl">
          <AssetCreateForm />
        </div>
      </GlassCard>

      {rows.length === 0 ? (
        <EmptyState
          icon={Gem}
          title="No assets yet"
          hint="Add a tangible holding using the form above."
        />
      ) : (
        <div className="grid gap-6 xl:grid-cols-2 items-start">
          {CATEGORY_ORDER.filter((c) => groups.has(c)).map((category) => {
            const items = groups.get(category)!;
            const subTotal = items.reduce((s, r) => s + assetValueMad(r, fx), 0);
            return (
              <GlassCard key={category} padding={false}>
                <div className="px-4 sm:px-5 py-3.5 border-b border-white/5 flex items-center justify-between gap-3">
                  <h2 className="font-medium">{CATEGORY_LABEL[category]}</h2>
                  <span className="text-sm font-medium text-neutral-200 tabular-nums">
                    <Sensitive>{fmtBase(subTotal, base, fx)}</Sensitive>
                  </span>
                </div>
                <ul className="divide-y divide-white/[0.04]">
                  {items.map((r) => (
                    <AssetRow
                      key={r.id}
                      row={toRowData(r)}
                      baseDisplay={fmtBase(assetValueMad(r, fx), base, fx)}
                    />
                  ))}
                </ul>
              </GlassCard>
            );
          })}
        </div>
      )}
    </Shell>
  );
}
