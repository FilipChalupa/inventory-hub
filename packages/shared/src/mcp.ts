import { z } from 'zod';

/** What an MCP connection may do: read-only, or read + write tools. */
export const mcpAccessLevels = ['read', 'read-write'] as const;
export const mcpAccessSchema = z.enum(mcpAccessLevels);
export type McpAccess = z.infer<typeof mcpAccessSchema>;

/** Expiry presets (days) offered for personal MCP tokens; null = never. */
export const MCP_TOKEN_EXPIRY_DAYS = [30, 90, 365] as const;

export const createMcpTokenInput = z.object({
  name: z.string().trim().min(1).max(100),
  access: mcpAccessSchema.default('read'),
  expiresInDays: z
    .number()
    .int()
    .refine((d) => (MCP_TOKEN_EXPIRY_DAYS as readonly number[]).includes(d))
    .nullable()
    .default(90),
});
export type CreateMcpTokenInput = z.infer<typeof createMcpTokenInput>;
