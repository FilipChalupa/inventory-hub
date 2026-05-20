import { z } from 'zod';

export const USER_ROLES = ['admin', 'operator', 'member', 'auditor'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const userSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().min(1).max(200),
  role: z.enum(USER_ROLES),
  createdAt: z.coerce.date(),
});
export type User = z.infer<typeof userSchema>;
