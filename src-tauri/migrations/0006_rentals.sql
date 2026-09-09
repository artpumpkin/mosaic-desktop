CREATE TABLE `rental_bookings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guest_name` text NOT NULL,
	`check_in_date` text NOT NULL,
	`check_out_date` text NOT NULL,
	`nights` integer NOT NULL,
	`amount_paid_mad` real NOT NULL,
	`platform` text NOT NULL,
	`status` text DEFAULT 'confirmed' NOT NULL,
	`note` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE INDEX `rental_bookings_check_in_idx` ON `rental_bookings` (`check_in_date`);
CREATE INDEX `rental_bookings_check_out_idx` ON `rental_bookings` (`check_out_date`);
CREATE TABLE `rental_turnovers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`turnover_date` text NOT NULL,
	`booking_out_id` integer,
	`booking_in_id` integer,
	`cleaner_cost_mad` real DEFAULT 0 NOT NULL,
	`fuel_cost_mad` real DEFAULT 0 NOT NULL,
	`sweets_cost_mad` real DEFAULT 0 NOT NULL,
	`other_cost_mad` real DEFAULT 0 NOT NULL,
	`other_note` text,
	`cleaning_done` integer DEFAULT 0 NOT NULL,
	`guest_welcomed` integer DEFAULT 0 NOT NULL,
	`keys_returned` integer DEFAULT 0 NOT NULL,
	`note` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE INDEX `rental_turnovers_date_idx` ON `rental_turnovers` (`turnover_date`);
