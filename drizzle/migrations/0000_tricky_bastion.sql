CREATE TABLE `bank_accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`label` text NOT NULL,
	`currency` text NOT NULL,
	`balance` real DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `cash_holdings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`label` text NOT NULL,
	`currency` text NOT NULL,
	`amount` real DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `debts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`direction` text NOT NULL,
	`counterparty` text NOT NULL,
	`amount` real NOT NULL,
	`currency` text DEFAULT 'MAD' NOT NULL,
	`due_on` text,
	`status` text DEFAULT 'open' NOT NULL,
	`note` text
);
--> statement-breakpoint
CREATE TABLE `eth_wallets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`label` text NOT NULL,
	`address` text NOT NULL,
	`last_synced_at` text,
	`last_error` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `eth_wallets_address_unique` ON `eth_wallets` (`address`);--> statement-breakpoint
CREATE TABLE `exchange_accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`exchange` text NOT NULL,
	`label` text NOT NULL,
	`api_key_enc` text NOT NULL,
	`api_secret_enc` text NOT NULL,
	`passphrase_enc` text,
	`last_synced_at` text,
	`last_error` text
);
--> statement-breakpoint
CREATE TABLE `expense_budgets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`category` text NOT NULL,
	`monthly_amount_mad` real NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `expense_budgets_category_unique` ON `expense_budgets` (`category`);--> statement-breakpoint
CREATE TABLE `expenses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`category` text NOT NULL,
	`amount` real NOT NULL,
	`currency` text DEFAULT 'MAD' NOT NULL,
	`occurred_on` text NOT NULL,
	`note` text
);
--> statement-breakpoint
CREATE TABLE `fx_rates` (
	`base` text NOT NULL,
	`quote` text NOT NULL,
	`rate` real NOT NULL,
	`fetched_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `holdings_cache` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_type` text NOT NULL,
	`source_id` integer NOT NULL,
	`asset_symbol` text NOT NULL,
	`amount` real NOT NULL,
	`price_usd` real DEFAULT 0 NOT NULL,
	`value_mad` real DEFAULT 0 NOT NULL,
	`fetched_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `incomes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`amount` real NOT NULL,
	`currency` text DEFAULT 'MAD' NOT NULL,
	`occurred_on` text NOT NULL,
	`recurring` integer DEFAULT false NOT NULL,
	`note` text
);
--> statement-breakpoint
CREATE TABLE `net_worth_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`captured_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`total_mad` real NOT NULL,
	`breakdown_json` text NOT NULL
);
