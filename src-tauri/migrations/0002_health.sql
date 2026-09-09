CREATE TABLE `weight_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`recorded_at` text NOT NULL,
	`weight_kg` real NOT NULL,
	`note` text
);
CREATE INDEX `weight_entries_recorded_at_idx` ON `weight_entries` (`recorded_at`);
CREATE TABLE `calorie_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`recorded_at` text NOT NULL,
	`kcal` integer NOT NULL,
	`label` text,
	`note` text
);
CREATE INDEX `calorie_entries_recorded_at_idx` ON `calorie_entries` (`recorded_at`);
