import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { orgSettings } from '../db/schema.js';
import { emitWebhook } from './webhooks.js';
import { setupTestServer, type TestServer } from './test-server.js';

describe('emitWebhook', () => {
  let server: TestServer;

  beforeEach(() => {
    server = setupTestServer();
  });

  afterEach(() => {
    server.close();
    vi.restoreAllMocks();
  });

  it('POSTs a signed event when a webhook URL is configured', () => {
    server.db
      .update(orgSettings)
      .set({ webhookUrl: 'https://hook.example/x', webhookSecret: 'sek' })
      .where(eq(orgSettings.id, 'singleton'))
      .run();
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }));

    emitWebhook(server.db, 'asset.archived', { code: 'LAP-1' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://hook.example/x');
    const headers = opts!.headers as Record<string, string>;
    expect(headers['x-inventory-signature']).toMatch(/^sha256=[0-9a-f]{64}$/);
    const parsed = JSON.parse(opts!.body as string);
    expect(parsed.event).toBe('asset.archived');
    expect(parsed.data.code).toBe('LAP-1');
  });

  it('does nothing when no webhook URL is set', () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }));

    emitWebhook(server.db, 'asset.archived', { code: 'LAP-1' });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
