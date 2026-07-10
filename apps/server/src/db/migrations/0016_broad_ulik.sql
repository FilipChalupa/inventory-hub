ALTER TABLE `assets` ADD `service_interval_days` integer;--> statement-breakpoint
ALTER TABLE `assets` ADD `last_serviced_at` integer;--> statement-breakpoint
ALTER TABLE `assets` ADD `service_reminder_sent_at` integer;