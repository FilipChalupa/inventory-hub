CREATE TABLE `inventory_item_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`note` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `inventory_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `inventory_item_notes_session_idx` ON `inventory_item_notes` (`session_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_item_notes_session_asset_unique` ON `inventory_item_notes` (`session_id`,`asset_id`);--> statement-breakpoint
ALTER TABLE `inventory_sessions` ADD `type_ids` text;--> statement-breakpoint
ALTER TABLE `inventory_sessions` ADD `asset_ids` text;