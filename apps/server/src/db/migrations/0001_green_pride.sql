PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_asset_types` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`code_prefix` text NOT NULL,
	`custom_fields_schema` text DEFAULT '[]' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_asset_types`("id", "name", "code_prefix", "custom_fields_schema", "created_at", "updated_at") SELECT "id", "name", "code_prefix", "custom_fields_schema", "created_at", "updated_at" FROM `asset_types`;--> statement-breakpoint
DROP TABLE `asset_types`;--> statement-breakpoint
ALTER TABLE `__new_asset_types` RENAME TO `asset_types`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `asset_types_code_prefix_unique` ON `asset_types` (`code_prefix`);--> statement-breakpoint
UPDATE `asset_types` SET `custom_fields_schema` = '[]' WHERE `custom_fields_schema` = '{}' OR `custom_fields_schema` IS NULL;