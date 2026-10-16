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

/**
 * Org-wide rules for AI-agent (MCP) access, set by admins. Apply to every
 * connection on each request; `maxTokenDays` limits newly created personal
 * tokens (null = no limit, "never expires" allowed).
 */
export const mcpPolicySchema = z.object({
  enabled: z.boolean().default(true),
  // Roles whose connections may use write tools. Auditors are read-only
  // everywhere regardless.
  writeRoles: z
    .array(z.enum(['admin', 'operator', 'member']))
    .default(['admin', 'operator', 'member']),
  maxTokenDays: z
    .number()
    .int()
    .refine((d) => (MCP_TOKEN_EXPIRY_DAYS as readonly number[]).includes(d))
    .nullable()
    .default(null),
});
export type McpPolicy = z.infer<typeof mcpPolicySchema>;
export const DEFAULT_MCP_POLICY: McpPolicy = mcpPolicySchema.parse({});
