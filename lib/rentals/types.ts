export type BookingPlatform = "airbnb" | "booking" | "direct" | "other";
export type BookingStatus = "confirmed" | "pending" | "completed" | "cancelled";

export type Booking = {
  id: number;
  guestName: string;
  checkInDate: string;
  checkOutDate: string;
  nights: number;
  amountPaidMad: number;
  platform: BookingPlatform;
  status: BookingStatus;
  note: string | null;
  createdAt: string;
};

export type Turnover = {
  id: number;
  turnoverDate: string;
  bookingOutId: number | null;
  bookingInId: number | null;
  cleanerCostMad: number;
  fuelCostMad: number;
  sweetsCostMad: number;
  otherCostMad: number;
  otherNote: string | null;
  cleaningDone: boolean;
  guestWelcomed: boolean;
  keysReturned: boolean;
  note: string | null;
  createdAt: string;
};

export type RentalSettings = {
  nightlyRateMad: number;
  cleanerDefaultMad: number;
  fuelDefaultMad: number;
  sweetsDefaultMad: number;
  distanceKmRoundTrip: number;
  fuelPricePerLiterMad: number;
  consumptionLper100km: number;
};

export const DEFAULT_RENTAL_SETTINGS: RentalSettings = {
  nightlyRateMad: 500,
  cleanerDefaultMad: 200,
  fuelDefaultMad: 64,
  sweetsDefaultMad: 50,
  distanceKmRoundTrip: 63,
  fuelPricePerLiterMad: 14.5,
  consumptionLper100km: 7,
};

export const PLATFORM_LABEL: Record<BookingPlatform, string> = {
  airbnb: "Airbnb",
  booking: "Booking.com",
  direct: "Direct",
  other: "Other",
};

export const STATUS_LABEL: Record<BookingStatus, string> = {
  confirmed: "Confirmed",
  pending: "Pending",
  completed: "Completed",
  cancelled: "Cancelled",
};
