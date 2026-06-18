import { z } from 'zod';
import { assetCodeSchema } from './asset.js';

export const inventorySessionStatuses = ['open', 'closed'] as const;
export type InventorySessionStatus = (typeof inventorySessionStatuses)[number];

export const inventorySessionSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200),
  locationId: z.string().uuid().nullable(),
  typeIds: z.array(z.string().uuid()).nullable(),
  assetIds: z.array(z.string().uuid()).nullable(),
  status: z.enum(inventorySessionStatuses),
  note: z.string().nullable(),
  startedByUserId: z.string().uuid().nullable(),
  closedAt: z.coerce.date().nullable(),
  closedByUserId: z.string().uuid().nullable(),
  createdAt: z.coerce.date(),
});
export type InventorySession = z.infer<typeof inventorySessionSchema>;

export const createInventorySessionInput = z.object({
  // Optional human label; the server fills in a date-based default when empty.
  name: z.string().min(1).max(200).optional(),
  // Scope. When `assetCodes` is set the session covers exactly those
  // hand-picked assets (resolved to ids server-side). Otherwise the expected
  // set is non-archived assets matching `locationId` (its subtree) AND
  // `typeIds` — each applied only when given, and an omitted/empty pair means
  // the whole organization.
  locationId: z.string().uuid().nullable().optional(),
  typeIds: z.array(z.string().uuid()).max(100).optional(),
  assetCodes: z.array(assetCodeSchema).max(2000).optional(),
  note: z.string().max(1000).nullable().optional(),
});
export type CreateInventorySessionInput = z.infer<typeof createInventorySessionInput>;

export const updateInventorySessionInput = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  note: z.string().max(1000).nullable().optional(),
});
export type UpdateInventorySessionInput = z.infer<typeof updateInventorySessionInput>;

export const inventoryItemNoteInput = z.object({
  // Empty string clears the note.
  note: z.string().max(1000),
});
export type InventoryItemNoteInput = z.infer<typeof inventoryItemNoteInput>;

export const scanInventoryInput = z.object({
  code: assetCodeSchema,
});
export type ScanInventoryInput = z.infer<typeof scanInventoryInput>;

export const markMissingLostInput = z.object({
  codes: z.array(assetCodeSchema).min(1, 'Vyber alespoň jeden asset').max(500),
});
export type MarkMissingLostInput = z.infer<typeof markMissingLostInput>;

/**
 * Outcome of a single scan, used for immediate operator feedback:
 *  - `found`      — asset belongs to the session's expected set (✅ counted).
 *  - `unexpected` — asset exists but is archived or outside the scope's
 *                   location subtree (found in the wrong place).
 *  - `already`    — asset was already scanned in this session (idempotent).
 */
export const scanResultKinds = ['found', 'unexpected', 'already'] as const;
export type ScanResultKind = (typeof scanResultKinds)[number];
