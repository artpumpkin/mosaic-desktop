CREATE TABLE `fasting_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text,
	`target_hours` real,
	`type` text NOT NULL,
	`note` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE INDEX `fasting_sessions_started_at_idx` ON `fasting_sessions` (`started_at`);
CREATE INDEX `fasting_sessions_active_idx` ON `fasting_sessions` (`ended_at`);
