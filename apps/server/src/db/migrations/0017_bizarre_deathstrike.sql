ALTER TABLE `assets` ADD `parent_asset_id` text REFERENCES assets(id);--> statement-breakpoint
ALTER TABLE `assets` ADD `useful_life_months` integer;--> statement-breakpoint
CREATE INDEX `assets_parent_idx` ON `assets` (`parent_asset_id`);--> statement-breakpoint
ALTER TABLE `loans` ADD `requested_by_user_id` text REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `loans` ADD `approved_at` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `last_notifications_seen_at` integer;