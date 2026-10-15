/**
 * End-to-end check of a freshly minted MCP token straight from the browser:
 * initialize a session on /mcp, list the tools, then close the session. Proves
 * the token, the endpoint and the server's tool registry all work — exactly
 * what the user's agent is about to do.
 */
export type McpProbeResult = { ok: true; toolCount: number } | { ok: false; error: string };

async function rpc(
  token: string,
  body: unknown,
  sessionId?: string,
): Promise<{ res: Response; json: any }> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    authorization: `Bearer ${token}`,
  };
  if (sessionId) headers['mcp-session-id'] = sessionId;
  // `credentials: 'omit'`: authenticate with the bearer alone, like a real agent.
  const res = await fetch('/mcp', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    credentials: 'omit',
  });
  const json = await res.json().catch(() => null);
  return { res, json };
}

export async function probeMcpToken(token: string): Promise<McpProbeResult> {
  try {
    const init = await rpc(token, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'inventory-hub-web-probe', version: '1' },
      },
    });
    if (!init.res.ok) return { ok: false, error: `HTTP ${init.res.status}` };
    const sid = init.res.headers.get('mcp-session-id') ?? undefined;
    const list = await rpc(token, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, sid);
    if (sid) {
      void fetch('/mcp', {
        method: 'DELETE',
        headers: { authorization: `Bearer ${token}`, 'mcp-session-id': sid },
        credentials: 'omit',
      }).catch(() => undefined);
    }
    const tools = list.json?.result?.tools;
    if (!list.res.ok || !Array.isArray(tools)) {
      return { ok: false, error: list.json?.error?.message ?? `HTTP ${list.res.status}` };
    }
    return { ok: true, toolCount: tools.length };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
