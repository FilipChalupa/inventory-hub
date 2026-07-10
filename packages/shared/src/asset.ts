import { z } from 'zod';

export const ASSET_STATUSES = [
  'in_stock',
  'assigned',
  'on_loan',
  'in_repair',
  'damaged',
  'sold',
  'lost',
  'retired',
] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

export const TERMINAL_ASSET_STATUSES = [
  'damaged',
  'sold',
  'lost',
  'retired',
] as const satisfies readonly AssetStatus[];

export const assetCodeSchema = z
  .string()
  .trim()
  .min(3)
  .max(40)
  .regex(
    /^[A-Z0-9]+(-[A-Z0-9]+)+$/,
    'Kód musí být ve formátu PREFIX-SEKCE-CISLO (jen A–Z, 0–9, -)',
  );

/**
 * Optional lifecycle / procurement metadata, shared by the create and update
 * inputs. `purchasePrice` is in the org's currency minor units (e.g. cents) to
 * avoid floating-point rounding; the UI converts to/from a decimal amount.
 */
export const assetLifecycleFields = {
  purchasedAt: z.coerce.date().nullable().optional(),
  warrantyUntil: z.coerce.date().nullable().optional(),
  purchasePrice: z.number().int().min(0).max(1_000_000_000_00).nullable().optional(),
  supplier: z.string().trim().max(200).nullable().optional(),
  // Planned maintenance: service every N days, counted from the last service
  // (or purchase/creation date). Null interval = no schedule.
  serviceIntervalDays: z.number().int().min(1).max(3650).nullable().optional(),
  lastServicedAt: z.coerce.date().nullable().optional(),
};

export const assetSchema = z.object({
  code: assetCodeSchema,
  name: z.string().min(1).max(200),
  typeId: z.string().uuid().nullable(),
  locationId: z.string().uuid().nullable(),
  assignedToUserId: z.string().uuid().nullable(),
  status: z.enum(ASSET_STATUSES),
  archivedAt: z.coerce.date().nullable(),
  customFields: z.record(z.string(), z.unknown()).default({}),
  photoPaths: z.array(z.string()).default([]),
  documentPaths: z.array(z.string()).default([]),
  purchasedAt: z.coerce.date().nullable(),
  warrantyUntil: z.coerce.date().nullable(),
  purchasePrice: z.number().int().nullable(),
  supplier: z.string().nullable(),
  serviceIntervalDays: z.number().int().nullable(),
  lastServicedAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Asset = z.infer<typeof assetSchema>;

export const createAssetInput = z.object({
  code: assetCodeSchema.optional(),
  name: z.string().trim().min(1).max(200),
  typeId: z.string().uuid().nullable().optional(),
  locationId: z.string().uuid().nullable().optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
  ...assetLifecycleFields,
});
export type CreateAssetInput = z.infer<typeof createAssetInput>;

export const assetEventTypes = [
  'created',
  'updated',
  'assigned',
  'unassigned',
  'moved',
  'status_changed',
  'archived',
  'unarchived',
  'damage_reported',
  'damage_resolved',
  'loan_started',
  'loan_item_returned',
  'repair_started',
  'repair_finished',
  'serviced',
] as const;
export type AssetEventType = (typeof assetEventTypes)[number];

/**
 * Computes when an asset's next service is due, or null when it has no
 * maintenance schedule. Counts `serviceIntervalDays` from the last service,
 * falling back to the purchase date and then the creation date.
 */
export function nextServiceDue(asset: {
  serviceIntervalDays: number | null;
  lastServicedAt: Date | null;
  purchasedAt: Date | null;
  createdAt: Date;
}): Date | null {
  if (!asset.serviceIntervalDays) return null;
  const base = asset.lastServicedAt ?? asset.purchasedAt ?? asset.createdAt;
  return new Date(base.getTime() + asset.serviceIntervalDays * 24 * 60 * 60 * 1000);
}
