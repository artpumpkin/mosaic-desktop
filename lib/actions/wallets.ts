import { db, schema } from "@/lib/db/client";
import { eq, or, sql } from "drizzle-orm";
import { invalidate } from "@/lib/query/bus";
import { walletCreateSchema, idOnlySchema } from "@/lib/validation/forms";
import { firstZodIssue, type ActionResult } from "@/lib/actions/result";

export async function createWallet(
  _: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = walletCreateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: firstZodIssue(parsed.error) };
  const { label, address } = parsed.data;
  try {
    const dup = await db
      .select({
        id: schema.ethWallets.id,
        label: schema.ethWallets.label,
        address: schema.ethWallets.address,
      })
      .from(schema.ethWallets)
      .where(
        or(
          sql`lower(${schema.ethWallets.label}) = lower(${label})`,
          eq(schema.ethWallets.address, address),
        ),
      );
    if (dup.length > 0) {
      const matchByAddress = dup.find((r) => r.address === address);
      if (matchByAddress) {
        return { ok: false, error: "That wallet address is already added" };
      }
      return { ok: false, error: `A wallet labeled "${label}" already exists` };
    }
    await db.insert(schema.ethWallets).values({ label, address });
    invalidate("wallets", "dashboard");
    return { ok: true, message: "Wallet added" };
  } catch (e) {
    console.error("createWallet failed", e);
    return { ok: false, error: "Could not add wallet" };
  }
}

export async function deleteWallet(
  _: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = idOnlySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: firstZodIssue(parsed.error) };
  const { id } = parsed.data;
  try {
    await db.delete(schema.ethWallets).where(eq(schema.ethWallets.id, id));
    await db
      .delete(schema.holdingsCache)
      .where(eq(schema.holdingsCache.sourceId, id));
    invalidate("wallets", "dashboard");
    return { ok: true, message: "Wallet removed" };
  } catch (e) {
    console.error("deleteWallet failed", e);
    return { ok: false, error: "Could not remove wallet" };
  }
}
