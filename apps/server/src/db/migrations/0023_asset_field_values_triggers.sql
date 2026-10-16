-- Keep asset_field_values (flattened scalar custom-field values, used by the
-- identifier lookup) in sync with assets.custom_fields. The normalization
-- must match normalizeIdentifier() in src/db/identifier-sql.ts.
CREATE TRIGGER `asset_field_values_after_insert` AFTER INSERT ON `assets` BEGIN
  INSERT INTO `asset_field_values` (`asset_id`, `key`, `value`, `value_norm`)
  SELECT NEW.`id`, je.key, CAST(je.value AS TEXT), upper(replace(replace(replace(replace(replace(replace(CAST(je.value AS TEXT), ' ', ''), '-', ''), '_', ''), '.', ''), ':', ''), '/', ''))
  FROM json_each(NEW.`custom_fields`) je
  WHERE je.type IN ('text', 'integer', 'real');
END;--> statement-breakpoint
CREATE TRIGGER `asset_field_values_after_update` AFTER UPDATE OF `custom_fields` ON `assets` BEGIN
  DELETE FROM `asset_field_values` WHERE `asset_id` = NEW.`id`;
  INSERT INTO `asset_field_values` (`asset_id`, `key`, `value`, `value_norm`)
  SELECT NEW.`id`, je.key, CAST(je.value AS TEXT), upper(replace(replace(replace(replace(replace(replace(CAST(je.value AS TEXT), ' ', ''), '-', ''), '_', ''), '.', ''), ':', ''), '/', ''))
  FROM json_each(NEW.`custom_fields`) je
  WHERE je.type IN ('text', 'integer', 'real');
END;--> statement-breakpoint
-- Backfill existing assets.
INSERT INTO `asset_field_values` (`asset_id`, `key`, `value`, `value_norm`)
SELECT a.`id`, je.key, CAST(je.value AS TEXT), upper(replace(replace(replace(replace(replace(replace(CAST(je.value AS TEXT), ' ', ''), '-', ''), '_', ''), '.', ''), ':', ''), '/', ''))
FROM `assets` a, json_each(a.`custom_fields`) je
WHERE je.type IN ('text', 'integer', 'real');
