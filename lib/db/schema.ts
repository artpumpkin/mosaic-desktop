import { sql } from "drizzle-orm";
import {
  integer,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export const bankAccounts = sqliteTable("bank_accounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  label: text("label").notNull(),
  currency: text("currency").notNull(),
  balance: real("balance").notNull().default(0),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const cashHoldings = sqliteTable("cash_holdings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  label: text("label").notNull(),
  currency: text("currency").notNull(),
  amount: real("amount").notNull().default(0),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const exchangeAccounts = sqliteTable("exchange_accounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  exchange: text("exchange", { enum: ["binance", "okx"] }).notNull(),
  label: text("label").notNull(),
  apiKeyEnc: text("api_key_enc").notNull(),
  apiSecretEnc: text("api_secret_enc").notNull(),
  passphraseEnc: text("passphrase_enc"),
  lastSyncedAt: text("last_synced_at"),
  lastError: text("last_error"),
});

export const ethWallets = sqliteTable("eth_wallets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  label: text("label").notNull(),
  address: text("address").notNull().unique(),
  lastSyncedAt: text("last_synced_at"),
  lastError: text("last_error"),
});

export const holdingsCache = sqliteTable("holdings_cache", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sourceType: text("source_type", { enum: ["binance", "okx", "eth"] }).notNull(),
  sourceId: integer("source_id").notNull(),
  assetSymbol: text("asset_symbol").notNull(),
  amount: real("amount").notNull(),
  priceUsd: real("price_usd").notNull().default(0),
  valueMad: real("value_mad").notNull().default(0),
  fetchedAt: text("fetched_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const expenses = sqliteTable("expenses", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  category: text("category").notNull(),
  amount: real("amount").notNull(),
  currency: text("currency").notNull().default("MAD"),
  occurredOn: text("occurred_on").notNull(),
  note: text("note"),
});

export const expenseBudgets = sqliteTable("expense_budgets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  category: text("category").notNull().unique(),
  monthlyAmountMad: real("monthly_amount_mad").notNull(),
});

export const incomes = sqliteTable("incomes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  source: text("source").notNull(),
  amount: real("amount").notNull(),
  currency: text("currency").notNull().default("MAD"),
  occurredOn: text("occurred_on").notNull(),
  recurring: integer("recurring", { mode: "boolean" }).notNull().default(false),
  note: text("note"),
});

export const debts = sqliteTable("debts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  direction: text("direction", { enum: ["i_owe", "owed_to_me"] }).notNull(),
  counterparty: text("counterparty").notNull(),
  amount: real("amount").notNull(),
  currency: text("currency").notNull().default("MAD"),
  dueOn: text("due_on"),
  status: text("status", { enum: ["open", "settled"] }).notNull().default("open"),
  note: text("note"),
});

export const netWorthSnapshots = sqliteTable("net_worth_snapshots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  capturedAt: text("captured_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  totalMad: real("total_mad").notNull(),
  breakdownJson: text("breakdown_json").notNull(),
});

export const fxRates = sqliteTable("fx_rates", {
  base: text("base").notNull(),
  quote: text("quote").notNull(),
  rate: real("rate").notNull(),
  fetchedAt: text("fetched_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const weightEntries = sqliteTable("weight_entries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  recordedAt: text("recorded_at").notNull(),
  weightKg: real("weight_kg").notNull(),
  note: text("note"),
});

export const fastingSessions = sqliteTable("fasting_sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  startedAt: text("started_at").notNull(),
  endedAt: text("ended_at"),
  targetHours: real("target_hours"),
  type: text("type", {
    enum: ["omad", "24h", "48h", "72h", "1w", "custom"],
  }).notNull(),
  note: text("note"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const rentalBookings = sqliteTable("rental_bookings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  guestName: text("guest_name").notNull(),
  checkInDate: text("check_in_date").notNull(),
  checkOutDate: text("check_out_date").notNull(),
  nights: integer("nights").notNull(),
  amountPaidMad: real("amount_paid_mad").notNull(),
  platform: text("platform", {
    enum: ["airbnb", "booking", "direct", "other"],
  }).notNull(),
  status: text("status", {
    enum: ["confirmed", "pending", "completed", "cancelled"],
  })
    .notNull()
    .default("confirmed"),
  note: text("note"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const rentalTurnovers = sqliteTable("rental_turnovers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  turnoverDate: text("turnover_date").notNull(),
  bookingOutId: integer("booking_out_id"),
  bookingInId: integer("booking_in_id"),
  cleanerCostMad: real("cleaner_cost_mad").notNull().default(0),
  fuelCostMad: real("fuel_cost_mad").notNull().default(0),
  sweetsCostMad: real("sweets_cost_mad").notNull().default(0),
  otherCostMad: real("other_cost_mad").notNull().default(0),
  otherNote: text("other_note"),
  cleaningDone: integer("cleaning_done", { mode: "boolean" }).notNull().default(false),
  guestWelcomed: integer("guest_welcomed", { mode: "boolean" }).notNull().default(false),
  keysReturned: integer("keys_returned", { mode: "boolean" }).notNull().default(false),
  note: text("note"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const assets = sqliteTable("assets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  category: text("category", {
    enum: ["precious_metal", "real_estate", "vehicle", "collectible", "other"],
  }).notNull(),
  label: text("label").notNull(),
  metal: text("metal", { enum: ["XAU", "XAG", "XPT", "XPD"] }),
  quantity: real("quantity"),
  unit: text("unit", { enum: ["oz", "g", "kg"] }),
  manualValue: real("manual_value"),
  currency: text("currency").notNull().default("MAD"),
  pricePerOzUsd: real("price_per_oz_usd"),
  lastPricedAt: text("last_priced_at"),
  acquiredOn: text("acquired_on"),
  acquiredValue: real("acquired_value"),
  note: text("note"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
