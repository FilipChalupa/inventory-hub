ALTER TABLE `assets` ADD `purchased_at` integer;--> statement-breakpoint
ALTER TABLE `assets` ADD `warranty_until` integer;--> statement-breakpoint
ALTER TABLE `assets` ADD `purchase_price` integer;--> statement-breakpoint
ALTER TABLE `assets` ADD `supplier` text;--> statement-breakpoint
ALTER TABLE `assets` ADD `warranty_reminder_sent_at` integer;--> statement-breakpoint
CREATE INDEX `assets_warranty_idx` ON `assets` (`warranty_until`);