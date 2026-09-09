import { db, schema } from "@/lib/db/client";
import { and, eq, ne, sql } from "drizzle-orm";
import type { z } from "zod";
import { invalidate } from "@/lib/query/bus";
import {
  assetCreateSchema,
  assetUpdateSchema,
  idOnlySchema,
} from "@/lib/validation/forms";
import { firstZodIssue, type ActionResult } from "@/lib/actions/result";
import { fetchMetalsUsdPerOz, type MetalSymbol } from "@/lib/integrations/metals";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;
type CreateInput = z.infer<typeof assetCreateSchema>;
type UpdateInput = z.infer<typeof assetUpdateSchema>;

function toInsert(data: CreateInput | DistributiveOmit<UpdateInput, "id">) {
  if (data.category === "precious_metal") {
    return {
      category: data.category,
      label: data.label,
      metal: data.metal,
      quantity: data.quantity,
      unit: data.unit,
      manualValue: data.manualValue ?? null,
      currency: data.currency,
      acquiredOn: data.acquiredOn ?? null,
      acquiredValue: data.acquiredValue ?? null,
      note: data.note ?? null,
    };
  }
  return {
    category: data.category,
    label: data.label,
    metal: null,
    quantity: null,
    unit: null,
    manualValue: data.manualValue,
    currency: data.currency,
    acquiredOn: data.acquiredOn ?? null,
    acquiredValue: data.acquiredValue ?? null,
    note: data.note ?? null,
  };
}

export async function createAsset(
  _: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = assetCreateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: firstZodIssue(parsed.error) };
  try {
    const dup = await db
      .select({ id: schema.assets.id })
      .from(schema.assets)
      .where(sql`lower(${schema.assets.label}) = lower(${parsed.data.label})`);
    if (dup.length > 0) {
      return { ok: false, error: `An asset labeled "${parsed.data.label}" already exists` };
    }
    await db.insert(schema.assets).values(toInsert(parsed.data));
    invalidate("assets", "dashboard");
    return { ok: true, message: "Asset added" };
  } catch (e) {
    console.error("createAsset failed", e);
    return { ok: false, error: "Could not add asset" };
  }
}

export async function updateAsset(
  _: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = assetUpdateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: firstZodIssue(parsed.error) };
  const { id, ...rest } = parsed.data;
  try {
    const dup = await db
      .select({ id: schema.assets.id })
      .from(schema.assets)
      .where(
        and(
          sql`lower(${schema.assets.label}) = lower(${rest.label})`,
          ne(schema.assets.id, id),
        ),
      );
    if (dup.length > 0) {
      return { ok: false, error: `An asset labeled "${rest.label}" already exists` };
    }
    await db
      .update(schema.assets)
      .set({ ...toInsert(rest), updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(schema.assets.id, id));
    invalidate("assets", "dashboard");
    return { ok: true, message: "Asset updated" };
  } catch (e) {
    console.error("updateAsset failed", e);
    return { ok: false, error: "Could not update asset" };
  }
}

export async function deleteAsset(
  _: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = idOnlySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: firstZodIssue(parsed.error) };
  try {
    await db.delete(schema.assets).where(eq(schema.assets.id, parsed.data.id));
    invalidate("assets", "dashboard");
    return { ok: true, message: "Asset removed" };
  } catch (e) {
    console.error("deleteAsset failed", e);
    return { ok: false, error: "Could not remove asset" };
  }
}

export async function refreshAssetPrices(
  _: ActionResult | null,
  _formData: FormData,
): Promise<ActionResult> {
  try {
    const prices = await fetchMetalsUsdPerOz(true);
    const keys = Object.keys(prices) as MetalSymbol[];
    if (keys.length === 0) {
      return { ok: false, error: "Could not fetch metal prices" };
    }
    const now = new Date().toISOString();
    for (const metal of keys) {
      const price = prices[metal]!;
      await db
        .update(schema.assets)
        .set({ pricePerOzUsd: price, lastPricedAt: now })
        .where(eq(schema.assets.metal, metal));
    }
    invalidate("assets", "dashboard");
    return { ok: true, message: "Prices refreshed" };
  } catch (e) {
    console.error("refreshAssetPrices failed", e);
    return { ok: false, error: "Could not refresh prices" };
  }
}
