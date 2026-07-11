import { createHmac } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { orgSettings } from '../db/schema.js';

/** Event names emitted to the configured outbound webhook. */
export type WebhookEvent =
  | 'loan.overdue'
  | 'damage.reported'
  | 'asset.archived'
  | 'warranty.expiring'
  | 'service.due';

/**
 * POSTs an event to the org's configured webhook URL (if any), signing the body
 * with `X-Inventory-Signature: sha256=<hmac>` when a secret is set. Fire-and-
 * forget: never throws and never blocks the caller — failures are logged.
 */
export function emitWebhook(db: Db, event: WebhookEvent, data: Record<string, unknown>): void {
  let url: string | null;
  let secret: string | null;
  try {
    const org = db
      .select({ webhookUrl: orgSettings.webhookUrl, webhookSecret: orgSettings.webhookSecret })
      .from(orgSettings)
      .where(eq(orgSettings.id, 'singleton'))
      .get();
    url = org?.webhookUrl ?? null;
    secret = org?.webhookSecret ?? null;
  } catch (err) {
    console.error('webhook config read failed:', err);
    return;
  }
  if (!url) return;

  const body = JSON.stringify({ event, at: new Date().toISOString(), data });
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (secret) {
    headers['x-inventory-signature'] =
      `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
  }
  void fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(10_000) }).then(
    (res) => {
      if (!res.ok) console.error(`webhook ${event} -> ${url} responded ${res.status}`);
    },
    (err) => console.error(`webhook ${event} -> ${url} failed:`, err),
  );
}
