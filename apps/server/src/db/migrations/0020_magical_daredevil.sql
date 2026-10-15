CREATE TABLE `mcp_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`actor_user_id` text,
	`type` text NOT NULL,
	`kind` text NOT NULL,
	`connection_name` text NOT NULL,
	`access` text,
	`occurred_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `mcp_events_user_idx` ON `mcp_events` (`user_id`);--> statement-breakpoint
CREATE INDEX `mcp_events_occurred_idx` ON `mcp_events` (`occurred_at`);--> statement-breakpoint
ALTER TABLE `asset_events` ADD `via` text;--> statement-breakpoint
ALTER TABLE `oauth_tokens` ADD `connected_at` integer;--> statement-breakpoint
ALTER TABLE `oauth_tokens` ADD `expiry_notified_at` integer;