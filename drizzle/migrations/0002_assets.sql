CREATE TABLE `assets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`category` text NOT NULL,
	`label` text NOT NULL,
	`metal` text,
	`quantity` real,
	`unit` text,
	`manual_value` real,
	`currency` text DEFAULT 'MAD' NOT NULL,
	`price_per_oz_usd` real,
	`last_priced_at` text,
	`acquired_on` text,
	`acquired_value` real,
	`note` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `assets_category_idx` ON `assets` (`category`);
