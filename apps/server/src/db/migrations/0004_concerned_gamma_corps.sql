CREATE TABLE `asset_external_ids` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`kind` text NOT NULL,
	`value` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `asset_external_ids_asset_idx` ON `asset_external_ids` (`asset_id`);--> statement-breakpoint
CREATE INDEX `asset_external_ids_value_idx` ON `asset_external_ids` (`value`);--> statement-breakpoint
CREATE UNIQUE INDEX `asset_external_ids_kind_value_unique` ON `asset_external_ids` (`kind`,`value`);