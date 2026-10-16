/**
 * Org-wide rules for AI-agent (MCP) access. Read on every request (one
 * single-row lookup), so an admin's change applies to live connections at
 * once — no reconnect needed.
 */
import { eq } from 'drizzle-orm';
import { DEFAULT_MCP_POLICY, mcpPolicySchema, type McpPolicy } from '@inventory-hub/shared';
import type { Db } from '../db/client.js';
import { orgSettings, type UserRow } from '../db/schema.js';

export function getMcpPolicy(db: Db): McpPolicy {
  const row = db
    .select({ policy: orgSettings.mcpPolicy })
    .from(orgSettings)
    .where(eq(orgSettings.id, 'singleton'))
    .get();
  const parsed = mcpPolicySchema.safeParse(row?.policy ?? {});
  return parsed.success ? parsed.data : DEFAULT_MCP_POLICY;
}

export function setMcpPolicy(db: Db, policy: McpPolicy): void {
  db.update(orgSettings)
    .set({ mcpPolicy: policy, updatedAt: new Date() })
    .where(eq(orgSettings.id, 'singleton'))
    .run();
}

/** Whether connections of a user with this role may use write tools. */
export function roleMayWrite(policy: McpPolicy, role: UserRow['role']): boolean {
  return role !== 'auditor' && (policy.writeRoles as string[]).includes(role);
}

export const MCP_DISABLED_MESSAGE =
  'AI-agent (MCP) access is turned off for this organization by an administrator.';
