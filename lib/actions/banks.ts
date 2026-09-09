import { db, schema } from "@/lib/db/client";
import { and, eq, ne, sql } from "drizzle-orm";
import { invalidate } from "@/lib/query/bus";
import { bankCreateSchema, bankUpdateSchema, idOnlySchema } from "@/lib/validation/forms";
import { firstZodIssue, type ActionResult } from "@/lib/actions/result";

async function findDuplicateLabel(label: string, excludeId?: number) {
  const rows = await db
    .select({ id: schema.bankAccounts.id })
    .from(schema.bankAccounts)
    .where(sql`lower(${schema.bankAccounts.label}) = lower(${label})`);
  return rows.some((r) => r.id !== excludeId);
}

export async function createBank(
  _: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = bankCreateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: firstZodIssue(parsed.error) };
  const { label, currency, balance } = parsed.data;
  try {
    if (await findDuplicateLabel(label)) {
      return { ok: false, error: `A bank labeled "${label}" already exists` };
    }
    await db.insert(schema.bankAccounts).values({ label, currency, balance });
    invalidate("banks", "dashboard");
    return { ok: true, message: "Bank added" };
  } catch (e) {
    console.error("createBank failed", e);
    return { ok: false, error: "Could not add bank" };
  }
}

export async function updateBank(
  _: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = bankUpdateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: firstZodIssue(parsed.error) };
  const { id, label, currency, balance } = parsed.data;
  try {
    const dupRows = await db
      .select({ id: schema.bankAccounts.id })
      .from(schema.bankAccounts)
      .where(
        and(
          sql`lower(${schema.bankAccounts.label}) = lower(${label})`,
          ne(schema.bankAccounts.id, id),
        ),
      );
    if (dupRows.length > 0) {
      return { ok: false, error: `A bank labeled "${label}" already exists` };
    }
    await db
      .update(schema.bankAccounts)
      .set({ label, currency, balance, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(schema.bankAccounts.id, id));
    invalidate("banks", "dashboard");
    return { ok: true, message: "Bank updated" };
  } catch (e) {
    console.error("updateBank failed", e);
    return { ok: false, error: "Could not update bank" };
  }
}

export async function deleteBank(
  _: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = idOnlySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: firstZodIssue(parsed.error) };
  try {
    await db.delete(schema.bankAccounts).where(eq(schema.bankAccounts.id, parsed.data.id));
    invalidate("banks", "dashboard");
    return { ok: true, message: "Bank removed" };
  } catch (e) {
    console.error("deleteBank failed", e);
    return { ok: false, error: "Could not remove bank" };
  }
}
