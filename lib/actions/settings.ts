import { z } from "zod";
import {
  setBaseCurrency,
  setAlchemyApiKey,
  setRealDebridApiKey,
  setUnitsPreference,
  SUPPORTED_BASE_CURRENCIES,
} from "@/lib/settings";
import { invalidate } from "@/lib/query/bus";
import { unitsPreferenceSchema } from "@/lib/validation/forms";
import { firstZodIssue, type ActionResult } from "@/lib/actions/result";

const baseCurrencySchema = z.object({
  baseCurrency: z.enum(SUPPORTED_BASE_CURRENCIES, {
    message: "Unsupported base currency",
  }),
});

export async function updateBaseCurrency(
  _: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = baseCurrencySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: firstZodIssue(parsed.error) };
  try {
    await setBaseCurrency(parsed.data.baseCurrency);
    invalidate("*");
    return { ok: true, message: `Base currency set to ${parsed.data.baseCurrency}` };
  } catch (e) {
    console.error("updateBaseCurrency failed", e);
    return { ok: false, error: "Could not update base currency" };
  }
}

const alchemySchema = z.object({
  alchemyApiKey: z.string().transform((s) => s.trim()),
});

export async function updateAlchemyApiKey(
  _: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = alchemySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: firstZodIssue(parsed.error) };
  try {
    await setAlchemyApiKey(parsed.data.alchemyApiKey);
    invalidate("settings");
    return {
      ok: true,
      message: parsed.data.alchemyApiKey ? "Alchemy key saved" : "Alchemy key removed",
    };
  } catch (e) {
    console.error("updateAlchemyApiKey failed", e);
    return { ok: false, error: "Could not save Alchemy key" };
  }
}

const realDebridSchema = z.object({
  realDebridApiKey: z.string().transform((s) => s.trim()),
});

export async function updateRealDebridApiKey(
  _: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = realDebridSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: firstZodIssue(parsed.error) };
  try {
    await setRealDebridApiKey(parsed.data.realDebridApiKey);
    invalidate("settings");
    return {
      ok: true,
      message: parsed.data.realDebridApiKey
        ? "Real-Debrid token saved"
        : "Real-Debrid token removed",
    };
  } catch (e) {
    console.error("updateRealDebridApiKey failed", e);
    return { ok: false, error: "Could not save Real-Debrid token" };
  }
}

export async function updateUnitsPreference(
  _: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = unitsPreferenceSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: firstZodIssue(parsed.error) };
  try {
    await setUnitsPreference(parsed.data.unitsPreference);
    invalidate("*");
    return {
      ok: true,
      message: `Units set to ${parsed.data.unitsPreference}`,
    };
  } catch (e) {
    console.error("updateUnitsPreference failed", e);
    return { ok: false, error: "Could not update units" };
  }
}
