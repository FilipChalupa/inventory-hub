import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { createMcpTokenInput, mcpPolicySchema } from '@inventory-hub/shared';
import type { AppContext } from '../app.js';
import { requireAuth } from '../middleware/auth.js';
import {
  createPersonalToken,
  getPersonalTokenOwner,
  listConnections,
  listMcpEvents,
  revokeOauthConnection,
  revokePersonalToken,
} from '../mcp/connections.js';
import { notifyAgentConnected } from '../mcp/notify.js';
import { MCP_TOOLS } from '../mcp/tools.js';
import { MCP_DISABLED_MESSAGE, getMcpPolicy, roleMayWrite, setMcpPolicy } from '../mcp/policy.js';

// Every user manages their own MCP access (OAuth connections + personal
// tokens); admins can additionally list and revoke anyone's via `?all=1` /
// `?userId=`.
export const mcpConnectionRoutes = new Hono<AppContext>()
  .use('*', requireAuth())
  .get('/', (c) => {
    const user = c.get('user')!;
    const all = c.req.query('all') === '1';
    if (all && user.role !== 'admin') {
      return c.json({ error: { message: 'Nedostatečná oprávnění' } }, 403);
    }
    const items = listConnections(c.get('db'), all ? {} : { userId: user.id });
    return c.json({ items });
  })
  // What a connected agent can do — shown on the AI assistants page.
  .get('/tools', (c) =>
    c.json({
      items: MCP_TOOLS.map((t) => ({ name: t.name, description: t.description, access: t.access })),
    }),
  )
  .get('/events', (c) => {
    const user = c.get('user')!;
    const all = c.req.query('all') === '1';
    if (all && user.role !== 'admin') {
      return c.json({ error: { message: 'Nedostatečná oprávnění' } }, 403);
    }
    const items = listMcpEvents(c.get('db'), all ? {} : { userId: user.id });
    return c.json({ items });
  })
  // Org-wide MCP rules: everyone may read them (the UI adapts), admins set them.
  .get('/policy', (c) => c.json(getMcpPolicy(c.get('db'))))
  .put('/policy', requireAuth('admin'), zValidator('json', mcpPolicySchema), (c) => {
    const policy = c.req.valid('json');
    setMcpPolicy(c.get('db'), policy);
    return c.json(policy);
  })
  .post('/tokens', zValidator('json', createMcpTokenInput), async (c) => {
    const user = c.get('user')!;
    const input = c.req.valid('json');
    const policy = getMcpPolicy(c.get('db'));
    if (!policy.enabled) return c.json({ error: { message: MCP_DISABLED_MESSAGE } }, 403);
    if (input.access === 'read-write' && !roleMayWrite(policy, user.role)) {
      return c.json({ error: { message: 'Administrátor pro tvou roli povolil jen čtení.' } }, 403);
    }
    if (
      policy.maxTokenDays !== null &&
      (input.expiresInDays === null || input.expiresInDays > policy.maxTokenDays)
    ) {
      return c.json(
        {
          error: {
            message: `Administrátor omezil platnost tokenů na nejvýš ${policy.maxTokenDays} dní.`,
          },
        },
        400,
      );
    }
    const created = createPersonalToken(c.get('db'), {
      user: { id: user.id, name: user.name, email: user.email },
      name: input.name,
      access: input.access,
      expiresInDays: input.expiresInDays,
    });
    const env = c.get('env');
    await notifyAgentConnected(c.get('db'), c.get('emailSender'), {
      userId: user.id,
      agentName: input.name,
      kind: 'personal',
      readWrite: input.access === 'read-write',
      publicAppUrl: env.PUBLIC_APP_URL,
      locale: env.EMAIL_LOCALE,
    });
    // The raw token is returned exactly once — only its hash is stored.
    return c.json({ ...created.connection, token: created.token }, 201);
  })
  .delete('/tokens/:id', (c) => {
    const db = c.get('db');
    const user = c.get('user')!;
    const id = c.req.param('id');
    const owner = getPersonalTokenOwner(db, id);
    if (!owner || (owner !== user.id && user.role !== 'admin')) {
      return c.json({ error: { message: 'Token nenalezen' } }, 404);
    }
    revokePersonalToken(db, id, user.id);
    return c.json({ ok: true });
  })
  .delete('/oauth/:clientId', (c) => {
    const user = c.get('user')!;
    const targetUserId = c.req.query('userId') ?? user.id;
    if (targetUserId !== user.id && user.role !== 'admin') {
      return c.json({ error: { message: 'Nedostatečná oprávnění' } }, 403);
    }
    const ok = revokeOauthConnection(c.get('db'), c.req.param('clientId'), targetUserId, user.id);
    if (!ok) return c.json({ error: { message: 'Připojení nenalezeno' } }, 404);
    return c.json({ ok: true });
  });
