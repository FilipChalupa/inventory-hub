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
});
export type OrgSettings = z.infer<typeof orgSettingsSchema>;
