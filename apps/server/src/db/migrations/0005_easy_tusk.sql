CREATE TABLE `contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text,
	`phone` text,
	`organization` text,
	`note` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `contacts_name_idx` ON `contacts` (`name`);--> statement-breakpoint
ALTER TABLE `loans` ADD `borrower_contact_id` text REFERENCES contacts(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX `loans_contact_idx` ON `loans` (`borrower_contact_id`);