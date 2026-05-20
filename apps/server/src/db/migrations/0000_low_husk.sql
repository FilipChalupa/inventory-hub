CREATE TABLE `asset_events` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`actor_user_id` text,
	`type` text NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`occurred_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `asset_events_asset_idx` ON `asset_events` (`asset_id`);--> statement-breakpoint
CREATE INDEX `asset_events_occurred_idx` ON `asset_events` (`occurred_at`);--> statement-breakpoint
CREATE TABLE `asset_types` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`code_prefix` text NOT NULL,
	`custom_fields_schema` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `asset_types_code_prefix_unique` ON `asset_types` (`code_prefix`);--> statement-breakpoint
CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`type_id` text,
	`location_id` text,
	`assigned_to_user_id` text,
	`status` text DEFAULT 'in_stock' NOT NULL,
	`archived_at` integer,
	`custom_fields` text DEFAULT '{}' NOT NULL,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`type_id`) REFERENCES `asset_types`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`assigned_to_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assets_code_unique` ON `assets` (`code`);--> statement-breakpoint
CREATE INDEX `assets_status_idx` ON `assets` (`status`);--> statement-breakpoint
CREATE INDEX `assets_type_idx` ON `assets` (`type_id`);--> statement-breakpoint
CREATE INDEX `assets_location_idx` ON `assets` (`location_id`);--> statement-breakpoint
CREATE TABLE `damage_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`reported_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`reported_by_user_id` text NOT NULL,
	`description` text NOT NULL,
	`severity` text NOT NULL,
	`photo_paths` text DEFAULT '[]' NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reported_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `damage_reports_asset_idx` ON `damage_reports` (`asset_id`);--> statement-breakpoint
CREATE TABLE `invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`token` text NOT NULL,
	`invited_by_user_id` text NOT NULL,
	`accepted_at` integer,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`invited_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invitations_token_unique` ON `invitations` (`token`);--> statement-breakpoint
CREATE TABLE `loan_items` (
	`id` text PRIMARY KEY NOT NULL,
	`loan_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`returned_at` integer,
	`return_condition` text,
	`return_notes` text,
	FOREIGN KEY (`loan_id`) REFERENCES `loans`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `loan_items_loan_idx` ON `loan_items` (`loan_id`);--> statement-breakpoint
CREATE INDEX `loan_items_asset_idx` ON `loan_items` (`asset_id`);--> statement-breakpoint
CREATE TABLE `loans` (
	`id` text PRIMARY KEY NOT NULL,
	`borrower_name` text NOT NULL,
	`borrower_user_id` text,
	`borrower_contact` text,
	`purpose` text,
	`loaned_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`expected_return_at` integer,
	`created_by_user_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`borrower_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `loans_expected_return_idx` ON `loans` (`expected_return_at`);--> statement-breakpoint
CREATE TABLE `locations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`parent_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `locations_parent_idx` ON `locations` (`parent_id`);--> statement-breakpoint
CREATE TABLE `org_settings` (
	`id` text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	`name` text NOT NULL,
	`code_prefix` text,
	`allowed_domains` text DEFAULT '[]' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`google_subject` text,
	`image_url` text,
	`disabled_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_google_subject_unique` ON `users` (`google_subject`);