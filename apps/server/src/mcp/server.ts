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
import type { EmailSender } from '../lib/email.js';
import { callApi, createMcpDispatchApp, type McpDispatchApp } from './dispatch.js';
import { runWithPrincipal, type McpPrincipal } from './principal.js';
import { scopeAllowsWrite } from './oauth-store.js';
import { MCP_TOOLS, type McpTool } from './tools.js';

const SERVER_INFO = { name: 'inventory-hub', version: '0.1.0' } as const;

type ToolResult = {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
};

function textResult(value: unknown, isError = false): ToolResult {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: 'text', text }], isError };
}

async function runTool(
  app: McpDispatchApp,
  t: McpTool,
  args: Record<string, unknown>,
  authInfo: AuthInfo | undefined,
): Promise<ToolResult> {
  const principal = authInfo?.extra?.principal as McpPrincipal | undefined;
  if (!principal) {
    return textResult({ error: 'Unauthorized: no MCP principal on request.' }, true);
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
  const spec = t.build(args ?? {});
  const result = await runWithPrincipal(principal, () =>
    callApi(app, spec.method, spec.path, spec.body),
  );
  return textResult(result.body, !result.ok);
}

function buildServer(app: McpDispatchApp): McpServer {
  const server = new McpServer(SERVER_INFO);
  for (const t of MCP_TOOLS) {
    server.registerTool(
      t.name,
      {
        description: t.description,
        inputSchema: t.inputShape,
        annotations: { readOnlyHint: t.access === 'read' },
      },
      async (args: Record<string, unknown>, extra: { authInfo?: AuthInfo }) =>
        runTool(app, t, args, extra?.authInfo),
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
};

/**
 * Builds the MCP runtime. Streamable HTTP is stateful: a transport+server pair
 * is created on the `initialize` request, keyed by the generated session id
 * (returned in the `mcp-session-id` response header), and reused for that
 * session's subsequent requests. Sessions are dropped on DELETE / close.
 */
export function createMcpRuntime(deps: { db: Db; env: Env; emailSender: EmailSender }): McpRuntime {
  const dispatchApp = createMcpDispatchApp(deps);
  const sessions = new Map<string, Session>();

  return {
    handle: async (req, authInfo) => {
      const sid = req.headers.get('mcp-session-id') ?? undefined;
      const existing = sid ? sessions.get(sid) : undefined;
      if (existing) {
        return existing.transport.handleRequest(req, { authInfo });
      }

      // New session: create a fresh transport + server (the transport rejects
      // non-initialize requests that lack a known session id).
      const session: Session = {} as Session;
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
      const server = buildServer(dispatchApp);
      session.transport = transport;
      session.server = server;
      await server.connect(transport);
      return transport.handleRequest(req, { authInfo });
    },
  };
}
