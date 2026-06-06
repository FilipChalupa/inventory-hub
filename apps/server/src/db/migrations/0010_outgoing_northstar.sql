CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`prefix` text NOT NULL,
	`token_hash` text NOT NULL,
	`user_id` text NOT NULL,
	`last_used_at` integer,
	`expires_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_token_hash_unique` ON `api_keys` (`token_hash`);--> statement-breakpoint
CREATE INDEX `api_keys_user_idx` ON `api_keys` (`user_id`);