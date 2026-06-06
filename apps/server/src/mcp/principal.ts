/**
 * Per-request MCP principal carried via AsyncLocalStorage.
 *
 * When an MCP tool runs, it resolves the bearer token to a user + granted
 * scope and stashes it here. The dispatch app (which re-uses the existing
 * Hono routers) reads it to populate `c.get('user')` instead of a session
 * cookie, so all existing `requireAuth(...)` role-gating keeps working
 * unchanged.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { UserRow } from '../db/schema.js';

export type McpPrincipal = {
  user: UserRow;
  /** Space-separated granted scope string, e.g. "mcp:read mcp:write". */
  scope: string;
};

const storage = new AsyncLocalStorage<McpPrincipal>();

export function runWithPrincipal<T>(principal: McpPrincipal, fn: () => T): T {
  return storage.run(principal, fn);
}

export function currentPrincipal(): McpPrincipal | undefined {
  return storage.getStore();
}
