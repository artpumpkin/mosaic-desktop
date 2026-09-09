import { db, schema } from "@/lib/db/client";
import { and, eq, sql } from "drizzle-orm";
import { invalidate } from "@/lib/query/bus";
import { encrypt } from "@/lib/crypto/encrypt";
import { exchangeCreateSchema, idOnlySchema } from "@/lib/validation/forms";
import { firstZodIssue, type ActionResult } from "@/lib/actions/result";

export async function createExchange(
  _: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = exchangeCreateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: firstZodIssue(parsed.error) };
  const { exchange, label, apiKey, apiSecret, passphrase } = parsed.data;
  try {
    const dup = await db
      .select({ id: schema.exchangeAccounts.id })
      .from(schema.exchangeAccounts)
      .where(sql`lower(${schema.exchangeAccounts.label}) = lower(${label})`);
    if (dup.length > 0) {
      return { ok: false, error: `An exchange labeled "${label}" already exists` };
    }
    const [apiKeyEnc, apiSecretEnc, passphraseEnc] = await Promise.all([
      encrypt(apiKey),
      encrypt(apiSecret),
      exchange === "okx" ? encrypt(passphrase) : Promise.resolve<string | null>(null),
    ]);
    await db.insert(schema.exchangeAccounts).values({
      exchange,
      label,
      apiKeyEnc,
      apiSecretEnc,
      passphraseEnc,
    });
    invalidate("exchanges", "dashboard");
    return { ok: true, message: "Exchange added" };
  } catch (e) {
    console.error("createExchange failed", e);
    return { ok: false, error: "Could not add exchange" };
  }
}

export async function deleteExchange(
  _: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = idOnlySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: firstZodIssue(parsed.error) };
  const { id } = parsed.data;
  try {
    const row = (
      await db
        .select()
        .from(schema.exchangeAccounts)
        .where(eq(schema.exchangeAccounts.id, id))
    )[0];
    await db.delete(schema.exchangeAccounts).where(eq(schema.exchangeAccounts.id, id));
    if (row) {
      await db
        .delete(schema.holdingsCache)
        .where(
          and(
            eq(schema.holdingsCache.sourceId, id),
            eq(schema.holdingsCache.sourceType, row.exchange),
          ),
        );
    }
    invalidate("exchanges", "dashboard");
    return { ok: true, message: "Exchange removed" };
  } catch (e) {
    console.error("deleteExchange failed", e);
    return { ok: false, error: "Could not remove exchange" };
  }
}
