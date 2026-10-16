/**
 * MCP runtime: builds the MCP server, registers the tool registry, and bridges
 * the Web-Standard Streamable HTTP transport to Hono. The exported `handle`
 * takes a fetch `Request` plus the already-verified principal and returns a
 * fetch `Response`.
 */
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { Db } from '../db/client.js';
import type { Env } from '../env.js';
import { getMcpIssuer } from '../env.js';
import type { EmailSender } from '../lib/email.js';
import { callApi, callApiRaw, createMcpDispatchApp, type McpDispatchApp } from './dispatch.js';
import { runWithPrincipal, type McpPrincipal } from './principal.js';
import { scopeAllowsWrite } from './oauth-store.js';
import { getMcpPolicy, roleMayWrite } from './policy.js';
import {
  DESTRUCTIVE_TOOLS,
  IDEMPOTENT_TOOLS,
  MCP_TOOLS,
  type McpTool,
  type ToolOutcome,
} from './tools.js';

const SERVER_INFO = { name: 'inventory-hub', version: '0.1.0' } as const;

type ToolResult = {
  content: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

/**
 * Compact JSON (no indentation — it's for a model, and whitespace is tokens).
 * Object results are also returned as `structuredContent` for clients that
 * consume it; the text copy keeps older clients working (per the MCP spec).
 */
function textResult(value: unknown, isError = false): ToolResult {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const result: ToolResult = { content: [{ type: 'text', text }], isError };
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    result.structuredContent = value as Record<string, unknown>;
  }
  return result;
}

/** Router errors come back as `{ error: { message } }`; flatten for the model. */
function errorResult(status: number, body: unknown): ToolResult {
  const b = body as { error?: { message?: string; fields?: unknown } | string } | undefined;
  const message = typeof b?.error === 'string' ? b.error : (b?.error?.message ?? `Request failed`);
  const fields = typeof b?.error === 'object' ? b.error?.fields : undefined;
  return textResult({ error: message, status, ...(fields ? { fields } : {}) }, true);
}

async function runTool(
  app: McpDispatchApp,
  t: McpTool,
  args: Record<string, unknown>,
  authInfo: AuthInfo | undefined,
  appUrl: string,
  serverUrl: string,
  db: Db,
): Promise<ToolResult> {
  const principal = authInfo?.extra?.principal as McpPrincipal | undefined;
  if (!principal) {
    return textResult({ error: 'Unauthorized: no MCP principal on request.' }, true);
  }
  if (t.access === 'write' && !roleMayWrite(getMcpPolicy(db), principal.user.role)) {
    return textResult(
      {
        error:
          'Your administrator has made AI-agent access read-only for your role, so write tools are unavailable.',
      },
      true,
    );
  }
  if (t.access === 'write' && !scopeAllowsWrite(principal.scope)) {
    return textResult(
      {
        error:
          'This connection is read-only (mcp:read). Re-pair the server choosing read-write access to use write tools.',
      },
      true,
    );
  }
  const result: ToolOutcome = await runWithPrincipal(principal, () => {
    if (t.run) {
      return t.run(args ?? {}, {
        call: (method, path, body) => callApi(app, method, path, body),
        callRaw: (path) => callApiRaw(app, path),
        principal,
        serverUrl,
      });
    }
    const spec = t.build(args ?? {});
    return callApi(app, spec.method, spec.path, spec.body);
  });
  if (!result.ok) return errorResult(result.status, result.body);
  let body = t.enrich ? t.enrich(result.body, appUrl) : result.body;
  if (t.shape) body = t.shape(body, args ?? {});
  const out = textResult(body);
  for (const img of result.images ?? []) {
    out.content.push({ type: 'image', data: img.data, mimeType: img.mimeType });
  }
  return out;
}

function buildServer(app: McpDispatchApp, appUrl: string, serverUrl: string, db: Db): McpServer {
  const server = new McpServer(SERVER_INFO);
  for (const t of MCP_TOOLS) {
    server.registerTool(
      t.name,
      {
        description: t.description,
        inputSchema: t.inputShape,
        annotations: {
          readOnlyHint: t.access === 'read',
          ...(t.access === 'write'
            ? {
                destructiveHint: DESTRUCTIVE_TOOLS.has(t.name),
                idempotentHint: IDEMPOTENT_TOOLS.has(t.name),
              }
            : {}),
          // Everything stays inside this inventory; no external side effects.
          openWorldHint: false,
        },
      },
      async (args: Record<string, unknown>, extra: { authInfo?: AuthInfo }) =>
        runTool(app, t, args, extra?.authInfo, appUrl, serverUrl, db),
    );
  }
  return server;
}

export type McpRuntime = {
  handle: (req: Request, authInfo: AuthInfo) => Promise<Response>;
};

type Session = {
  transport: WebStandardStreamableHTTPServerTransport;
  server: McpServer;
  lastSeen: number;
};

export type McpRuntimeOptions = {
  /** Drop a session after this long without a request (default 30 min). */
  idleTtlMs?: number;
  /** Hard cap on concurrent sessions; the least recently used go first. */
  maxSessions?: number;
  now?: () => number;
};

/**
 * Builds the MCP runtime. Streamable HTTP is stateful: a transport+server pair
 * is created on the `initialize` request, keyed by the generated session id
 * (returned in the `mcp-session-id` response header), and reused for that
 * session's subsequent requests.
 *
 * Clients are supposed to DELETE their session when done, but most just
 * vanish, so sessions also expire after `idleTtlMs` of silence and the map is
 * capped at `maxSessions`. An expired client gets a 404 on its next request,
 * which per the spec makes it re-initialize transparently.
 */
export function createMcpRuntime(
  deps: { db: Db; env: Env; emailSender: EmailSender },
  opts: McpRuntimeOptions = {},
): McpRuntime & { sessionCount: () => number } {
  const idleTtlMs = opts.idleTtlMs ?? 30 * 60 * 1000;
  const maxSessions = opts.maxSessions ?? 500;
  const now = opts.now ?? Date.now;
  const dispatchApp = createMcpDispatchApp(deps);
  const appUrl = deps.env.PUBLIC_APP_URL.replace(/\/$/, '');
  // Origin the MCP endpoint is served from (upload links point here).
  const serverUrl = getMcpIssuer(deps.env);
  // Map iteration order = insertion order; re-inserting on every hit keeps the
  // least recently used session first, which makes eviction O(evicted).
  const sessions = new Map<string, Session>();

  const drop = (id: string, s: Session) => {
    sessions.delete(id);
    void s.transport.close().catch(() => undefined);
    void s.server.close().catch(() => undefined);
  };

  const sweep = () => {
    const cutoff = now() - idleTtlMs;
    for (const [id, s] of sessions) {
      if (s.lastSeen >= cutoff && sessions.size < maxSessions) break;
      drop(id, s);
    }
  };

  return {
    sessionCount: () => sessions.size,
    handle: async (req, authInfo) => {
      sweep();
      const sid = req.headers.get('mcp-session-id') ?? undefined;
      const existing = sid ? sessions.get(sid) : undefined;
      if (sid && existing) {
        existing.lastSeen = now();
        sessions.delete(sid);
        sessions.set(sid, existing);
        return existing.transport.handleRequest(req, { authInfo });
      }

      // New session: create a fresh transport + server (the transport rejects
      // non-initialize requests that lack a known session id).
      const session = { lastSeen: now() } as Session;
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableJsonResponse: true,
        onsessioninitialized: (id) => {
          sessions.set(id, session);
        },
        onsessionclosed: (id) => {
          sessions.delete(id);
        },
      });
      const server = buildServer(dispatchApp, appUrl, serverUrl, deps.db);
      session.transport = transport;
      session.server = server;
      await server.connect(transport);
      return transport.handleRequest(req, { authInfo });
    },
  };
}
