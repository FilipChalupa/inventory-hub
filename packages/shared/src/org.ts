import { z } from 'zod';
import { USER_ROLES } from './user.js';

export const orgCodePrefix = z
  .string()
  .trim()
  .min(2)
  .max(6)
  .regex(/^[A-Z0-9]+$/, 'Prefix musí obsahovat pouze A–Z a 0–9')
  .nullable();

const lowercaseDomain = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(
    z
      .string()
      .regex(
        /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/,
        'Neplatná doména (exact match, bez subdomén)',
      ),
  );

export const allowedDomainSchema = z.object({
  domain: lowercaseDomain,
  defaultRole: z.enum(USER_ROLES).default('member'),
});
export type AllowedDomain = z.infer<typeof allowedDomainSchema>;

export const orgSettingsSchema = z.object({
  name: z.string().trim().min(1).max(200),
  codePrefix: orgCodePrefix,
  allowedDomains: z.array(allowedDomainSchema).default([]),
  // Lost-and-found: expose a minimal, unauthenticated public page per asset.
  publicLookupEnabled: z.boolean().default(false),
  // Outbound webhook (events POSTed here, HMAC-signed with the secret).
  webhookUrl: z.string().trim().url().max(500).nullable().default(null),
  webhookSecret: z.string().trim().max(200).nullable().default(null),
});
export type OrgSettings = z.infer<typeof orgSettingsSchema>;

/**
 * Organization-wide defaults for the label printer (shared across users so a
 * company prints uniform stickers).
 *  - `compact`: encode just the bare code in the QR (smaller/denser) instead
 *     of the full deep-link URL.
 *  - `showName`: print the asset name on the label.
 *  - `note`: free-text line under the code (e.g. a contact email).
 */
export const labelSettingsSchema = z.object({
  compact: z.boolean().default(false),
  showName: z.boolean().default(true),
  note: z.string().trim().max(200).default(''),
});
export type LabelSettings = z.infer<typeof labelSettingsSchema>;

export const DEFAULT_LABEL_SETTINGS: LabelSettings = {
  compact: false,
  showName: true,
  note: '',
};
