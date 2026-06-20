import { z } from 'zod';
import { ASSET_STATUSES } from './asset.js';
import { damageSeverities } from './damage.js';
import { customFieldDefSchema } from './custom-fields.js';

/**
 * Generic, source-agnostic bulk import payload (`POST /api/import`). Entities
 * cross-reference each other by caller-provided natural keys — `key` for types
 * and locations, `code` for assets — and the server assigns real ids. Unlike
 * the granular REST API it accepts explicit `status` / `createdAt` /
 * `archivedAt`, so historical data migrates faithfully.
 */

export const importTypeSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  codePrefix: z.string().min(1),
  customFieldsSchema: z.array(customFieldDefSchema).optional(),
});

export const importLocationSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  parentKey: z.string().nullish(),
});

export const importAssetSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  typeKey: z.string().nullish(),
  locationKey: z.string().nullish(),
  status: z.enum(ASSET_STATUSES).optional(),
  archivedAt: z.coerce.date().nullish(),
  createdAt: z.coerce.date().nullish(),
  customFields: z.record(z.string(), z.unknown()).optional(),
  notes: z.string().nullish(),
  externalIds: z.array(z.object({ kind: z.string().min(1), value: z.string().min(1) })).optional(),
  // Remote URLs the server downloads into storage…
  photoUrls: z.array(z.string().url()).optional(),
  // …or relative paths already present in UPLOAD_DIR (used by the symmetric
  // JSON export for hub→hub restore, where the upload dir is copied alongside).
  photoPaths: z.array(z.string()).optional(),
});

export const importLoanSchema = z.object({
  borrowerName: z.string().min(1),
  borrowerContact: z.string().nullish(),
  purpose: z.string().nullish(),
  loanedAt: z.coerce.date().optional(),
  startedAt: z.coerce.date().nullish(),
  expectedReturnAt: z.coerce.date().nullish(),
  createdAt: z.coerce.date().optional(),
  items: z
    .array(
      z.object({
        assetCode: z.string().min(1),
        returnedAt: z.coerce.date().nullish(),
        returnCondition: z.enum(['ok', 'damaged']).nullish(),
        returnNotes: z.string().nullish(),
      }),
    )
    .min(1),
});

export const importDamageSchema = z.object({
  assetCode: z.string().min(1),
  occurredAt: z.coerce.date(),
  reportedAt: z.coerce.date().optional(),
  description: z.string().min(1),
  severity: z.enum(damageSeverities),
  resolvedAt: z.coerce.date().nullish(),
  photoUrls: z.array(z.string().url()).optional(),
  photoPaths: z.array(z.string()).optional(),
});

export const importPayloadSchema = z.object({
  version: z.literal(1),
  assetTypes: z.array(importTypeSchema).default([]),
  locations: z.array(importLocationSchema).default([]),
  assets: z.array(importAssetSchema).default([]),
  loans: z.array(importLoanSchema).default([]),
  damages: z.array(importDamageSchema).default([]),
});
export type ImportPayload = z.infer<typeof importPayloadSchema>;

/**
 * A cross-reference in the payload that pointed at something that didn't
 * exist — a `typeKey`/`locationKey` not among the payload's types/locations,
 * or an `assetCode` (on a loan item or damage) with no matching asset. The row
 * is skipped rather than failing the whole import; reporting it surfaces
 * adapter mapping bugs, especially under `dryRun`.
 */
export const unresolvedReferenceSchema = z.object({
  kind: z.enum(['type', 'location', 'asset']),
  value: z.string(),
  context: z.string(),
});
export type UnresolvedReference = z.infer<typeof unresolvedReferenceSchema>;

export const importResultSchema = z.object({
  ok: z.literal(true),
  // When true the payload was validated and counted but nothing was written.
  dryRun: z.boolean(),
  types: z.number().int(),
  locations: z.number().int(),
  assets: z.number().int(),
  skippedAssets: z.number().int(),
  loans: z.number().int(),
  damages: z.number().int(),
  photos: z.number().int(),
  // photoUrls that could not be downloaded (reported, never fatal).
  photoFailures: z.array(z.string()),
  // Dangling cross-references that were skipped (reported, never fatal).
  unresolvedReferences: z.array(unresolvedReferenceSchema),
});
export type ImportResult = z.infer<typeof importResultSchema>;
