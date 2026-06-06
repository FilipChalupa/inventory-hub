CREATE TABLE `inventory_scans` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`scanned_by_user_id` text,
	`scanned_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `inventory_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`scanned_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `inventory_scans_session_idx` ON `inventory_scans` (`session_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_scans_session_asset_unique` ON `inventory_scans` (`session_id`,`asset_id`);--> statement-breakpoint
CREATE TABLE `inventory_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`location_id` text,
	`status` text DEFAULT 'open' NOT NULL,
	`note` text,
	`started_by_user_id` text,
	`closed_at` integer,
	`closed_by_user_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`started_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`closed_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
ALTER TABLE `assets` ADD `last_seen_at` integer;