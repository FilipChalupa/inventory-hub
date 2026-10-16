CREATE TABLE `asset_field_values` (
	`asset_id` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`value_norm` text NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `asset_field_values_asset_idx` ON `asset_field_values` (`asset_id`);--> statement-breakpoint
CREATE INDEX `asset_field_values_value_norm_idx` ON `asset_field_values` (`value_norm`);--> statement-breakpoint
CREATE INDEX `asset_external_ids_value_norm_idx` ON `asset_external_ids` (upper(replace(replace(replace(replace(replace(replace("value", ' ', ''), '-', ''), '_', ''), '.', ''), ':', ''), '/', '')));--> statement-breakpoint
CREATE INDEX `assets_code_norm_idx` ON `assets` (upper(replace(replace(replace(replace(replace(replace("code", ' ', ''), '-', ''), '_', ''), '.', ''), ':', ''), '/', '')));