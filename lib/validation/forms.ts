import { z } from "zod";
import { ethers } from "ethers";

const todayIso = () => new Date().toISOString().slice(0, 10);

const label = z
  .string()
  .transform((s) => s.trim())
  .pipe(z.string().min(1, "Label is required").max(80, "Label too long"));

const currency = z
  .string()
  .transform((s) => s.trim().toUpperCase())
  .pipe(z.enum(["MAD", "AED", "USD", "EUR"], { message: "Unsupported currency" }));

const positiveAmount = z.coerce
  .number({ message: "Amount must be a number" })
  .finite("Amount must be a finite number")
  .positive("Amount must be greater than 0");

const finiteAmount = z.coerce
  .number({ message: "Amount must be a number" })
  .finite("Amount must be a finite number");

const nonNegativeAmount = z.coerce
  .number({ message: "Amount must be a number" })
  .finite("Amount must be a finite number")
  .min(0, "Amount cannot be negative");

const idSchema = z.coerce
  .number({ message: "Invalid id" })
  .int("Invalid id")
  .positive("Invalid id");

const optionalText = (max: number, msg: string) =>
  z
    .string()
    .optional()
    .transform((s) => (s ?? "").trim())
    .pipe(z.string().max(max, msg))
    .transform((s) => (s.length ? s : null));

const isoDate = z
  .string()
  .transform((s) => s.trim())
  .pipe(
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD")
  );

const optionalIsoDate = z
  .string()
  .optional()
  .transform((s) => (s ?? "").trim())
  .pipe(
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD")
      .or(z.literal(""))
  )
  .transform((s) => (s.length ? s : null));

// --- Banks --------------------------------------------------------------
export const bankCreateSchema = z.object({
  label,
  currency,
  balance: finiteAmount,
});

export const bankUpdateSchema = z.object({
  id: idSchema,
  label,
  currency,
  balance: finiteAmount,
});

// --- Cash ---------------------------------------------------------------
export const cashCreateSchema = z.object({
  label,
  currency,
  amount: nonNegativeAmount,
});

export const cashUpdateSchema = z.object({
  id: idSchema,
  label,
  currency,
  amount: nonNegativeAmount,
});

// --- Exchanges ----------------------------------------------------------
const exchangeEnum = z.enum(["binance", "okx"], {
  message: "Pick an exchange",
});

const nonEmptyTrim = (msg: string) =>
  z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().min(1, msg));

export const exchangeCreateSchema = z
  .object({
    exchange: exchangeEnum,
    label,
    apiKey: nonEmptyTrim("API key is required"),
    apiSecret: nonEmptyTrim("API secret is required"),
    passphrase: z
      .string()
      .transform((s) => s.trim())
      .optional()
      .transform((s) => s ?? ""),
  })
  .refine((d) => d.exchange !== "okx" || d.passphrase.length > 0, {
    message: "OKX requires a passphrase",
    path: ["passphrase"],
  });

// --- Wallets ------------------------------------------------------------
export const walletCreateSchema = z.object({
  label,
  address: z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().min(1, "Address is required"))
    .refine((s) => ethers.isAddress(s), {
      message: "Invalid Ethereum address",
    })
    .transform((s) => ethers.getAddress(s)),
});

// --- Debts --------------------------------------------------------------
export const debtCreateSchema = z
  .object({
    direction: z.enum(["i_owe", "owed_to_me"], { message: "Invalid direction" }),
    counterparty: z
      .string()
      .transform((s) => s.trim())
      .pipe(z.string().min(1, "Counterparty is required").max(80, "Counterparty too long")),
    amount: positiveAmount,
    currency,
    dueOn: optionalIsoDate,
    note: optionalText(500, "Note too long"),
  })
  .refine((d) => !d.dueOn || d.dueOn >= todayIso(), {
    message: "Due date cannot be in the past",
    path: ["dueOn"],
  });

export const debtToggleSchema = z.object({
  id: idSchema,
  status: z.enum(["open", "settled"], { message: "Invalid status" }),
});

export const debtUpdateSchema = z.object({
  id: idSchema,
  direction: z.enum(["i_owe", "owed_to_me"], { message: "Invalid direction" }),
  counterparty: z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().min(1, "Counterparty is required").max(80, "Counterparty too long")),
  amount: positiveAmount,
  currency,
  dueOn: optionalIsoDate,
  note: optionalText(500, "Note too long"),
});

// --- Expenses & budgets -------------------------------------------------
const category = z
  .string()
  .transform((s) => s.trim())
  .pipe(z.string().min(1, "Category is required").max(80, "Category too long"));

export const expenseCreateSchema = z
  .object({
    category,
    amount: positiveAmount,
    currency,
    occurredOn: z
      .string()
      .transform((s) => s.trim())
      .transform((s) => (s.length ? s : todayIso()))
      .pipe(isoDate),
    note: optionalText(500, "Note too long"),
  })
  .refine((d) => d.occurredOn <= todayIso(), {
    message: "Expense date cannot be in the future",
    path: ["occurredOn"],
  });

export const budgetUpsertSchema = z.object({
  category,
  monthlyAmountMad: positiveAmount,
});

// --- Income -------------------------------------------------------------
export const incomeCreateSchema = z
  .object({
    source: z
      .string()
      .transform((s) => s.trim())
      .pipe(z.string().min(1, "Source is required").max(80, "Source too long")),
    amount: positiveAmount,
    currency,
    occurredOn: z
      .string()
      .transform((s) => s.trim())
      .transform((s) => (s.length ? s : todayIso()))
      .pipe(isoDate),
    recurring: z
      .string()
      .optional()
      .transform((v) => v === "on"),
    note: optionalText(500, "Note too long"),
  })
  .refine((d) => d.occurredOn <= todayIso(), {
    message: "Income date cannot be in the future",
    path: ["occurredOn"],
  });

// --- Fasting -----------------------------------------------------------
const fastTypeEnum = z.enum(
  ["omad", "24h", "48h", "72h", "1w", "custom"],
  { message: "Pick a fast type" },
);

const optionalIsoDateTime = z
  .string()
  .optional()
  .transform((s) => (s ?? "").trim())
  .transform((s) => {
    if (!s.length) return null;
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  });

const requiredIsoDateTime = z
  .string()
  .transform((s) => s.trim())
  .pipe(z.string().min(1, "Time is required"))
  .transform((s) => {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) throw new Error("Invalid date");
    return d.toISOString();
  });

const optionalPositiveHours = z
  .string()
  .optional()
  .transform((s) => (s ?? "").trim())
  .pipe(
    z
      .string()
      .regex(/^\d*\.?\d*$/, "Must be a number")
      .or(z.literal("")),
  )
  .transform((s) => (s.length ? Number(s) : null))
  .refine((v) => v === null || (v > 0 && Number.isFinite(v)), {
    message: "Must be greater than 0",
  });

export const fastStartSchema = z.object({
  type: fastTypeEnum,
  startedAt: optionalIsoDateTime,
  targetHours: optionalPositiveHours,
  note: optionalText(500, "Note too long"),
});

export const fastEndSchema = z.object({
  id: idSchema,
  endedAt: optionalIsoDateTime,
});

export const fastLogSchema = z
  .object({
    type: fastTypeEnum,
    startedAt: requiredIsoDateTime,
    endedAt: requiredIsoDateTime,
    targetHours: optionalPositiveHours,
    note: optionalText(500, "Note too long"),
  })
  .refine((d) => new Date(d.endedAt).getTime() > new Date(d.startedAt).getTime(), {
    message: "End time must be after start",
    path: ["endedAt"],
  });

export const fastUpdateSchema = z
  .object({
    id: idSchema,
    type: fastTypeEnum,
    startedAt: requiredIsoDateTime,
    endedAt: optionalIsoDateTime,
    targetHours: optionalPositiveHours,
    note: optionalText(500, "Note too long"),
  })
  .refine(
    (d) =>
      !d.endedAt ||
      new Date(d.endedAt).getTime() > new Date(d.startedAt).getTime(),
    { message: "End time must be after start", path: ["endedAt"] },
  );

// --- Assets ------------------------------------------------------------
const metalEnum = z.enum(["XAU", "XAG", "XPT", "XPD"], {
  message: "Pick a metal",
});

const unitEnum = z.enum(["oz", "g", "kg"], { message: "Pick a unit" });

const optionalFiniteAmount = z
  .string()
  .optional()
  .transform((s) => (s ?? "").trim())
  .pipe(
    z
      .string()
      .regex(/^-?\d*\.?\d*$/, "Must be a number")
      .or(z.literal("")),
  )
  .transform((s) => (s.length ? Number(s) : null))
  .refine((v) => v === null || Number.isFinite(v), {
    message: "Must be a finite number",
  });

const assetBase = {
  label,
  currency,
  acquiredOn: optionalIsoDate,
  acquiredValue: optionalFiniteAmount,
  note: optionalText(500, "Note too long"),
};

const assetCreateBase = z.discriminatedUnion("category", [
  z.object({
    category: z.literal("precious_metal"),
    metal: metalEnum,
    quantity: positiveAmount,
    unit: unitEnum,
    manualValue: optionalFiniteAmount,
    ...assetBase,
  }),
  z.object({
    category: z.literal("real_estate"),
    manualValue: nonNegativeAmount,
    ...assetBase,
  }),
  z.object({
    category: z.literal("vehicle"),
    manualValue: nonNegativeAmount,
    ...assetBase,
  }),
  z.object({
    category: z.literal("collectible"),
    manualValue: nonNegativeAmount,
    ...assetBase,
  }),
  z.object({
    category: z.literal("other"),
    manualValue: nonNegativeAmount,
    ...assetBase,
  }),
]);

export const assetCreateSchema = assetCreateBase;

export const assetUpdateSchema = z.discriminatedUnion("category", [
  z.object({
    id: idSchema,
    category: z.literal("precious_metal"),
    metal: metalEnum,
    quantity: positiveAmount,
    unit: unitEnum,
    manualValue: optionalFiniteAmount,
    ...assetBase,
  }),
  z.object({
    id: idSchema,
    category: z.literal("real_estate"),
    manualValue: nonNegativeAmount,
    ...assetBase,
  }),
  z.object({
    id: idSchema,
    category: z.literal("vehicle"),
    manualValue: nonNegativeAmount,
    ...assetBase,
  }),
  z.object({
    id: idSchema,
    category: z.literal("collectible"),
    manualValue: nonNegativeAmount,
    ...assetBase,
  }),
  z.object({
    id: idSchema,
    category: z.literal("other"),
    manualValue: nonNegativeAmount,
    ...assetBase,
  }),
]);

// --- Generic id-only ---------------------------------------------------
export const idOnlySchema = z.object({ id: idSchema });

// --- Health ------------------------------------------------------------
const optionalIsoTimestamp = z
  .string()
  .optional()
  .transform((s) => (s ?? "").trim())
  .transform((s) => {
    if (!s.length) return new Date().toISOString();
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  });

export const weightCreateSchema = z.object({
  weightKg: z.coerce
    .number({ message: "Weight must be a number" })
    .finite()
    .positive("Weight must be greater than 0"),
  recordedAt: optionalIsoTimestamp,
  note: optionalText(500, "Note too long"),
});

export const weightUpdateSchema = weightCreateSchema.extend({ id: idSchema });

const genderEnum = z.enum(["male", "female"], {
  message: "Pick a gender",
});

const activityEnum = z.enum(
  ["sedentary", "light", "moderate", "very", "extra"],
  { message: "Pick an activity level" },
);

const optionalPositiveNumber = z
  .string()
  .optional()
  .transform((s) => (s ?? "").trim())
  .pipe(
    z
      .string()
      .regex(/^\d*\.?\d*$/, "Must be a number")
      .or(z.literal("")),
  )
  .transform((s) => (s.length ? Number(s) : null))
  .refine((v) => v === null || (v > 0 && Number.isFinite(v)), {
    message: "Must be greater than 0",
  });

export const healthProfileSchema = z.object({
  heightCm: optionalPositiveNumber,
  gender: genderEnum,
  dateOfBirth: optionalIsoDate,
  activityLevel: activityEnum,
  goalWeightKg: optionalPositiveNumber,
  dailyCalorieTarget: optionalPositiveNumber,
});

export const unitsPreferenceSchema = z.object({
  unitsPreference: z.enum(["metric", "imperial"], { message: "Invalid unit" }),
});

// --- Rentals ------------------------------------------------------------
const platformEnum = z.enum(["airbnb", "booking", "direct", "other"], {
  message: "Pick a platform",
});

const bookingStatusEnum = z.enum(
  ["confirmed", "pending", "completed", "cancelled"],
  { message: "Pick a status" },
);

const guestName = z
  .string()
  .transform((s) => s.trim())
  .pipe(z.string().min(1, "Guest name is required").max(120, "Name too long"));

export const bookingCreateSchema = z
  .object({
    guestName,
    checkInDate: isoDate,
    checkOutDate: isoDate,
    amountPaidMad: nonNegativeAmount,
    platform: platformEnum,
    status: bookingStatusEnum,
    note: optionalText(500, "Note too long"),
  })
  .refine((d) => d.checkOutDate > d.checkInDate, {
    message: "Check-out must be after check-in",
    path: ["checkOutDate"],
  });

export const bookingUpdateSchema = z
  .object({
    id: idSchema,
    guestName,
    checkInDate: isoDate,
    checkOutDate: isoDate,
    amountPaidMad: nonNegativeAmount,
    platform: platformEnum,
    status: bookingStatusEnum,
    note: optionalText(500, "Note too long"),
  })
  .refine((d) => d.checkOutDate > d.checkInDate, {
    message: "Check-out must be after check-in",
    path: ["checkOutDate"],
  });

const optionalIdField = z
  .string()
  .optional()
  .transform((s) => (s ?? "").trim())
  .transform((s) => {
    if (!s.length) return null;
    const n = Number(s);
    return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
  });

const checkboxBool = z
  .string()
  .optional()
  .transform((v) => v === "on" || v === "true" || v === "1");

export const turnoverCreateSchema = z.object({
  turnoverDate: isoDate,
  bookingOutId: optionalIdField,
  bookingInId: optionalIdField,
  cleanerCostMad: nonNegativeAmount,
  fuelCostMad: nonNegativeAmount,
  sweetsCostMad: nonNegativeAmount,
  otherCostMad: nonNegativeAmount,
  otherNote: optionalText(200, "Note too long"),
  cleaningDone: checkboxBool,
  guestWelcomed: checkboxBool,
  keysReturned: checkboxBool,
  note: optionalText(500, "Note too long"),
});

export const turnoverUpdateSchema = turnoverCreateSchema.extend({
  id: idSchema,
});

export const rentalSettingsSchema = z.object({
  nightlyRateMad: positiveAmount,
  cleanerDefaultMad: nonNegativeAmount,
  fuelDefaultMad: nonNegativeAmount,
  sweetsDefaultMad: nonNegativeAmount,
  distanceKmRoundTrip: nonNegativeAmount,
  fuelPricePerLiterMad: positiveAmount,
  consumptionLper100km: positiveAmount,
});
