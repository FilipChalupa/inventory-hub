import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import type { AppContext } from '../app.js';
import { assetTypes, assets, orgSettings } from '../db/schema.js';

const SINGLETON_ID = 'singleton';

/** Minimal HTML escape for interpolated text. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function page(title: string, bodyHtml: string): string {
  return `<!doctype html><html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title><style>
    body{font-family:system-ui,sans-serif;margin:0;background:#f8fafc;color:#0f172a;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:1rem}
    .card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:1.5rem 1.75rem;max-width:28rem;width:100%;box-shadow:0 1px 3px rgba(0,0,0,.08)}
    h1{font-size:1.25rem;margin:0 0 .25rem}
    .code{font-family:ui-monospace,monospace;color:#475569;font-size:.9rem}
    dl{margin:1rem 0 0;display:grid;grid-template-columns:auto 1fr;gap:.35rem 1rem}
    dt{color:#64748b}dd{margin:0}
    .note{margin-top:1.25rem;padding-top:1rem;border-top:1px solid #e2e8f0;color:#334155}
    .muted{color:#64748b;font-size:.9rem}
    @media (prefers-color-scheme:dark){body{background:#0f172a;color:#e2e8f0}.card{background:#1e293b;border-color:#334155}.code,dt,.muted{color:#94a3b8}.note{border-color:#334155;color:#cbd5e1}}
  </style></head><body><div class="card">${bodyHtml}</div></body></html>`;
}

export const publicRoutes = new Hono<AppContext>().get('/:code', (c) => {
  const db = c.get('db');
  const org = db.select().from(orgSettings).where(eq(orgSettings.id, SINGLETON_ID)).get();
  // Feature is off by default; when disabled the page simply doesn't exist.
  if (!org?.publicLookupEnabled) return c.notFound();

  const code = c.req.param('code').toUpperCase();
  const row = db
    .select({
      code: assets.code,
      name: assets.name,
      status: assets.status,
      typeName: assetTypes.name,
    })
    .from(assets)
    .leftJoin(assetTypes, eq(assets.typeId, assetTypes.id))
    .where(eq(assets.code, code))
    .get();

  if (!row) {
    return c.html(
      page(
        'Nenalezeno',
        `<h1>Nenalezeno</h1><p class="muted">Pro tento kód nemáme žádný záznam.</p>`,
      ),
      404,
    );
  }

  const note = org.labelSettings?.note?.trim();
  const rows: string[] = [];
  if (row.typeName) rows.push(`<dt>Typ</dt><dd>${esc(row.typeName)}</dd>`);
  const body = `
    <h1>${esc(row.name)}</h1>
    <div class="code">${esc(row.code)}</div>
    <dl>${rows.join('')}<dt>Organizace</dt><dd>${esc(org.name)}</dd></dl>
    ${note ? `<div class="note"><strong>Nálezce?</strong> ${esc(note)}</div>` : '<p class="note muted">Pokud jste tento předmět našli, kontaktujte prosím jeho majitele.</p>'}
  `;
  return c.html(page(`${row.code} — ${org.name}`, body));
});
