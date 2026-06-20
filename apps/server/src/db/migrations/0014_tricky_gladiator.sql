ALTER TABLE `api_keys` ADD `scopes` text DEFAULT '["api"]' NOT NULL;--> statement-breakpoint
-- Grandfather existing keys: they were used for both REST and the calendar
-- feed, so grant both scopes to keep running integrations and subscriptions
-- working. New keys pick their scopes explicitly.
UPDATE `api_keys` SET `scopes` = '["api","feeds"]';