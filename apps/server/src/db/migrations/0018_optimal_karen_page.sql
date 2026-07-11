ALTER TABLE `org_settings` ADD `public_lookup_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `org_settings` ADD `webhook_url` text;--> statement-breakpoint
ALTER TABLE `org_settings` ADD `webhook_secret` text;