const STATUS_TITLES: Record<number, string> = {
  400: 'Neplatný požadavek',
  401: 'Nepřihlášeno',
  403: 'Přístup odepřen',
  404: 'Stránka nenalezena',
  409: 'Konflikt',
  410: 'Už neplatí',
  429: 'Příliš mnoho požadavků',
  500: 'Chyba serveru',
  503: 'Služba nedostupná',
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Renders a standalone, styled HTML error page for browser navigations. */
export function renderErrorPage(
  status: number,
  message: string,
  opts: { homeUrl?: string } = {},
): string {
  const title = STATUS_TITLES[status] ?? 'Chyba';
  const homeUrl = opts.homeUrl ?? '/';
  return `<!DOCTYPE html>
<html lang="cs">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="light dark" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <title>${status} · ${escapeHtml(title)} · Inventory Hub</title>
    <style>
      :root { color-scheme: light dark; }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 1.5rem;
        background: light-dark(#f8fafc, #0f172a);
        color: light-dark(#0f172a, #e2e8f0);
        font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        line-height: 1.5;
      }
      .card {
        width: 100%;
        max-width: 28rem;
        background: light-dark(#fff, #1e293b);
        border: 1px solid light-dark(#e2e8f0, #334155);
        border-radius: 1rem;
        padding: 2.5rem 2rem;
        text-align: center;
        box-shadow: 0 10px 30px -12px light-dark(rgba(15, 23, 42, 0.25), rgba(0, 0, 0, 0.5));
      }
      .status { font-size: 3rem; font-weight: 800; letter-spacing: -0.02em; color: light-dark(#0f172a, #f8fafc); }
      h1 { margin: 0.25rem 0 0.75rem; font-size: 1.25rem; font-weight: 600; }
      p { margin: 0 0 1.75rem; color: light-dark(#475569, #94a3b8); }
      a.home {
        display: inline-block;
        padding: 0.625rem 1.25rem;
        border-radius: 0.5rem;
        background: light-dark(#0f172a, #e2e8f0);
        color: light-dark(#f8fafc, #0f172a);
        text-decoration: none;
        font-weight: 500;
      }
      a.home:hover { background: light-dark(#1e293b, #cbd5e1); }
    </style>
  </head>
  <body>
    <main class="card">
      <div class="status">${status}</div>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(message)}</p>
      <a class="home" href="${escapeHtml(homeUrl)}">Zpět do aplikace</a>
    </main>
  </body>
</html>
`;
}
