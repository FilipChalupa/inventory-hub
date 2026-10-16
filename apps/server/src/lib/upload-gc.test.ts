import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { setupTestServer, type TestServer } from './test-server.js';
import { assets, damageReports } from '../db/schema.js';
import { pruneOrphanUploads } from './upload-gc.js';

let server: TestServer;
beforeEach(() => {
  server = setupTestServer();
});
afterEach(() => server.close());

const exists = (rel: string) => existsSync(join(server.env.UPLOAD_DIR, rel));

describe('pruneOrphanUploads', () => {
  it('deletes only old, unreferenced files in our layout', async () => {
    const assetId = crypto.randomUUID();
    const photo = server.storeUpload();
    const doc = server.storeUpload({ ext: 'pdf' });
    const damagePhoto = server.storeUpload();
    const orphanA = server.storeUpload();
    const orphanB = server.storeUpload();
    server.db
      .insert(assets)
      .values({ id: assetId, code: 'GC-1', name: 'GC', photoPaths: [photo], documentPaths: [doc] })
      .run();
    server.db
      .insert(damageReports)
      .values({
        id: crypto.randomUUID(),
        assetId,
        reportedByUserId: server.createUser().id,
        occurredAt: new Date(),
        description: 'x',
        severity: 'minor',
        photoPaths: [damagePhoto],
      })
      .run();
    // Something that isn't one of our uploads must never be touched.
    mkdirSync(join(server.env.UPLOAD_DIR, '2020/01'), { recursive: true });
    writeFileSync(join(server.env.UPLOAD_DIR, '2020/01/notes.txt'), 'keep');

    // Within the grace period nothing goes.
    expect((await pruneOrphanUploads(server.db, server.env, { graceDays: 7 })).deleted).toBe(0);

    const later = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);
    const res = await pruneOrphanUploads(server.db, server.env, { graceDays: 7, now: later });
    expect(res.deleted).toBe(2);
    expect(exists(orphanA)).toBe(false);
    expect(exists(orphanB)).toBe(false);
    for (const p of [photo, doc, damagePhoto, '2020/01/notes.txt']) {
      expect(exists(p), p).toBe(true);
    }

    // Detaching makes a file eligible.
    server.db.update(assets).set({ photoPaths: [] }).where(eq(assets.id, assetId)).run();
    await pruneOrphanUploads(server.db, server.env, { graceDays: 7, now: later });
    expect(exists(photo)).toBe(false);
  });

  it('copes with a missing upload dir', async () => {
    const res = await pruneOrphanUploads(
      server.db,
      { ...server.env, UPLOAD_DIR: '/nonexistent/x' },
      { graceDays: 7 },
    );
    expect(res).toEqual({ deleted: 0, kept: 0 });
  });
});
