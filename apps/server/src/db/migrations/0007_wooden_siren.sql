ALTER TABLE `loans` ADD `started_at` integer;--> statement-breakpoint
-- Existing loans predate planning; treat them as already started.
UPDATE `loans` SET `started_at` = `loaned_at` WHERE `started_at` IS NULL;
