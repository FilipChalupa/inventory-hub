import { z } from 'zod';

export const damageSeverities = ['minor', 'major', 'total'] as const;
export type DamageSeverity = (typeof damageSeverities)[number];

export const MAX_DAMAGE_PHOTOS = 10;

export const damageReportSchema = z.object({
  id: z.string().uuid(),
  assetId: z.string().uuid(),
  occurredAt: z.coerce.date(),
  reportedAt: z.coerce.date(),
  reportedByUserId: z.string().uuid(),
  description: z.string().trim().min(1).max(2000),
  severity: z.enum(damageSeverities),
  photoPaths: z.array(z.string()).max(MAX_DAMAGE_PHOTOS).default([]),
  resolvedAt: z.coerce.date().nullable(),
});
export type DamageReport = z.infer<typeof damageReportSchema>;

export const createDamageReportInput = damageReportSchema.pick({
  assetId: true,
  occurredAt: true,
  description: true,
  severity: true,
  photoPaths: true,
});
export type CreateDamageReportInput = z.infer<typeof createDamageReportInput>;
