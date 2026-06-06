import { z } from 'zod';

export const createApiKeyInput = z.object({
  name: z.string().trim().min(1).max(100),
  // Optional expiry; omit for a non-expiring key.
  expiresAt: z.coerce.date().nullable().optional(),
});
export type CreateApiKeyInput = z.infer<typeof createApiKeyInput>;
