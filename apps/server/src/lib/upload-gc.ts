import { readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { Db } from '../db/client.js';
import { assets, damageReports } from '../db/schema.js';
import type { Env } from '../env.js';

const YEAR = /^\d{4}$/;
const MONTH = /^\d{2}$/;
const STORED_FILE = /^[0-9a-f-]{36}\.(jpg|png|webp|gif|pdf)$/;

/** Every upload path some record still points at. */
function referencedPaths(db: Db): Set<string> {
  const refs = new Set<string>();
  for (const a of db
    .select({ photos: assets.photoPaths, docs: assets.documentPaths })
    .from(assets)
    .all()) {
    for (const p of a.photos ?? []) refs.add(p);
    for (const p of a.docs ?? []) refs.add(p);
  }
  for (const d of db.select({ photos: damageReports.photoPaths }).from(damageReports).all()) {
    for (const p of d.photos ?? []) refs.add(p);
  }
  return refs;
}

/**
 * Deletes uploaded files no record references any more — uploads abandoned
 * mid-form, photos an agent stored but never attached, files detached from
 * an asset. Only files in our own `YYYY/MM/<uuid>.<ext>` layout are touched,
 * and only once untouched for `graceDays`. Age counts from the later of mtime
 * and ctime, so files just copied in for a restore (`cp -p` keeps the old
 * mtime) survive until the import re-references them.
 */
export async function pruneOrphanUploads(
  db: Db,
  env: Env,
  opts: { graceDays: number; now?: Date },
): Promise<{ deleted: number; kept: number }> {
  const cutoff = (opts.now ?? new Date()).getTime() - opts.graceDays * 24 * 60 * 60 * 1000;
  const refs = referencedPaths(db);
  let deleted = 0;
  let kept = 0;
  const list = async (dir: string) => {
    try {
      return await readdir(dir);
    } catch {
      return [];
    }
  };
  for (const y of (await list(env.UPLOAD_DIR)).filter((d) => YEAR.test(d))) {
    for (const m of (await list(join(env.UPLOAD_DIR, y))).filter((d) => MONTH.test(d))) {
      for (const name of (await list(join(env.UPLOAD_DIR, y, m))).filter((f) =>
        STORED_FILE.test(f),
      )) {
        const rel = `${y}/${m}/${name}`;
        if (refs.has(rel)) {
          kept++;
          continue;
        }
        const abs = join(env.UPLOAD_DIR, rel);
        try {
          const st = await stat(abs);
          if (!st.isFile() || Math.max(st.mtimeMs, st.ctimeMs) > cutoff) {
            kept++;
            continue;
          }
          await unlink(abs);
          deleted++;
        } catch {
          // vanished or unreadable — leave it
        }
      }
    }
  }
  return { deleted, kept };
}
