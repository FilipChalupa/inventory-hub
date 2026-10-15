ALTER TABLE `oauth_tokens` ADD `kind` text DEFAULT 'oauth' NOT NULL;--> statement-breakpoint
ALTER TABLE `oauth_tokens` ADD `name` text;--> statement-breakpoint
ALTER TABLE `oauth_tokens` ADD `token_prefix` text;--> statement-breakpoint
ALTER TABLE `oauth_tokens` ADD `last_used_at` integer;