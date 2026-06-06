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

export const TERMINAL_ASSET_STATUSES = ['damaged', 'sold', 'lost', 'retired'] as const satisfies readonly AssetStatus[];

export const assetCodeSchema = z
  .string()
  .trim()
  .min(3)
  .max(40)
  .regex(/^[A-Z0-9]+(-[A-Z0-9]+)+$/, 'Kód musí být ve formátu PREFIX-SEKCE-CISLO (jen A–Z, 0–9, -)');

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
] as const;
export type AssetEventType = (typeof assetEventTypes)[number];
