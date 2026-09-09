import { db, schema } from "@/lib/db/client";
import { eq } from "drizzle-orm";
import { invalidate } from "@/lib/query/bus";
import {
  bookingCreateSchema,
  bookingUpdateSchema,
  turnoverCreateSchema,
  turnoverUpdateSchema,
  rentalSettingsSchema,
  idOnlySchema,
} from "@/lib/validation/forms";
import { firstZodIssue, type ActionResult } from "@/lib/actions/result";
import { nightsBetween } from "@/lib/rentals/math";
import { setRentalSettings } from "@/lib/settings";

const RENTAL_KEYS = ["rentals", "rentals:bookings", "rentals:turnovers", "rentals:calendar"] as const;

export async function createBooking(
  _: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = bookingCreateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: firstZodIssue(parsed.error) };
  const d = parsed.data;
  const nights = nightsBetween(d.checkInDate, d.checkOutDate);
  if (nights <= 0) return { ok: false, error: "Stay must be at least one night" };
  try {
    await db.insert(schema.rentalBookings).values({
      guestName: d.guestName,
      checkInDate: d.checkInDate,
      checkOutDate: d.checkOutDate,
      nights,
      amountPaidMad: d.amountPaidMad,
      platform: d.platform,
      status: d.status,
      note: d.note,
    });
    invalidate(...RENTAL_KEYS);
    return { ok: true, message: "Booking saved" };
  } catch (e) {
    console.error("createBooking failed", e);
    return { ok: false, error: "Could not save booking" };
  }
}

export async function updateBooking(
  _: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = bookingUpdateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: firstZodIssue(parsed.error) };
  const d = parsed.data;
  const nights = nightsBetween(d.checkInDate, d.checkOutDate);
  if (nights <= 0) return { ok: false, error: "Stay must be at least one night" };
  try {
    await db
      .update(schema.rentalBookings)
      .set({
        guestName: d.guestName,
        checkInDate: d.checkInDate,
        checkOutDate: d.checkOutDate,
        nights,
        amountPaidMad: d.amountPaidMad,
        platform: d.platform,
        status: d.status,
        note: d.note,
      })
      .where(eq(schema.rentalBookings.id, d.id));
    invalidate(...RENTAL_KEYS);
    return { ok: true, message: "Booking updated" };
  } catch (e) {
    console.error("updateBooking failed", e);
    return { ok: false, error: "Could not update booking" };
  }
}

export async function deleteBooking(
  _: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = idOnlySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: firstZodIssue(parsed.error) };
  try {
    await db
      .delete(schema.rentalBookings)
      .where(eq(schema.rentalBookings.id, parsed.data.id));
    invalidate(...RENTAL_KEYS);
    return { ok: true, message: "Booking removed" };
  } catch (e) {
    console.error("deleteBooking failed", e);
    return { ok: false, error: "Could not remove booking" };
  }
}

export async function createTurnover(
  _: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = turnoverCreateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: firstZodIssue(parsed.error) };
  const d = parsed.data;
  try {
    await db.insert(schema.rentalTurnovers).values({
      turnoverDate: d.turnoverDate,
      bookingOutId: d.bookingOutId,
      bookingInId: d.bookingInId,
      cleanerCostMad: d.cleanerCostMad,
      fuelCostMad: d.fuelCostMad,
      sweetsCostMad: d.sweetsCostMad,
      otherCostMad: d.otherCostMad,
      otherNote: d.otherNote,
      cleaningDone: d.cleaningDone,
      guestWelcomed: d.guestWelcomed,
      keysReturned: d.keysReturned,
      note: d.note,
    });
    invalidate(...RENTAL_KEYS);
    return { ok: true, message: "Turnover logged" };
  } catch (e) {
    console.error("createTurnover failed", e);
    return { ok: false, error: "Could not log turnover" };
  }
}

export async function updateTurnover(
  _: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = turnoverUpdateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: firstZodIssue(parsed.error) };
  const d = parsed.data;
  try {
    await db
      .update(schema.rentalTurnovers)
      .set({
        turnoverDate: d.turnoverDate,
        bookingOutId: d.bookingOutId,
        bookingInId: d.bookingInId,
        cleanerCostMad: d.cleanerCostMad,
        fuelCostMad: d.fuelCostMad,
        sweetsCostMad: d.sweetsCostMad,
        otherCostMad: d.otherCostMad,
        otherNote: d.otherNote,
        cleaningDone: d.cleaningDone,
        guestWelcomed: d.guestWelcomed,
        keysReturned: d.keysReturned,
        note: d.note,
      })
      .where(eq(schema.rentalTurnovers.id, d.id));
    invalidate(...RENTAL_KEYS);
    return { ok: true, message: "Turnover updated" };
  } catch (e) {
    console.error("updateTurnover failed", e);
    return { ok: false, error: "Could not update turnover" };
  }
}

export async function deleteTurnover(
  _: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = idOnlySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: firstZodIssue(parsed.error) };
  try {
    await db
      .delete(schema.rentalTurnovers)
      .where(eq(schema.rentalTurnovers.id, parsed.data.id));
    invalidate(...RENTAL_KEYS);
    return { ok: true, message: "Turnover removed" };
  } catch (e) {
    console.error("deleteTurnover failed", e);
    return { ok: false, error: "Could not remove turnover" };
  }
}

export async function updateRentalSettings(
  _: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = rentalSettingsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: firstZodIssue(parsed.error) };
  try {
    await setRentalSettings(parsed.data);
    invalidate("rentals", "rentals:settings");
    return { ok: true, message: "Settings saved" };
  } catch (e) {
    console.error("updateRentalSettings failed", e);
    return { ok: false, error: "Could not save settings" };
  }
}
