import { ns } from './util.js';

/** "AI assistants (MCP)" page — connecting agents + managing their access. */
export const agents = ns({
  cs: {
    title: 'AI asistenti (MCP)',
    intro:
      'Inventory Hub můžeš připojit ke svému AI asistentovi (Claude, ChatGPT, Cursor, vlastní agent…) přes Model Context Protocol. Asistent pak umí hledat assety, zakládat výpůjčky a další — vždy jen v rozsahu tvé role.',

    // OAuth connect
    connectTitle: 'Připojit přes přihlášení (doporučeno)',
    connectIntro:
      'Pro klienty, které umí OAuth (Claude Desktop/Code, claude.ai, ChatGPT…). Zadej URL konektoru; klient otevře prohlížeč, přihlásíš se a zvolíš, jestli smí jen číst, nebo i zapisovat.',
    connectorUrlLabel: 'URL konektoru',
    claudeCodeLabel: 'Příkaz pro Claude Code',
    googleWarn:
      'Přihlášení k MCP jede přes Google OAuth, který na tomto serveru není nakonfigurovaný. Použij osobní token níže.',

    // Personal tokens
    tokenTitle: 'Osobní token',
    tokenIntro:
      'Pro agenty a skripty, které OAuth neumí. Token se posílá v hlavičce Authorization: Bearer … a jedná tvým jménem. Uvidíš ho jen jednou.',
    tokenNameLabel: 'Název',
    tokenNamePlaceholder: 'např. n8n, můj agent',
    accessLabel: 'Oprávnění',
    accessRead: 'Jen čtení',
    accessReadWrite: 'Čtení i zápis',
    expiryLabel: 'Platnost',
    expiryDays: (d: number) => `${d} dní`,
    expiryNever: 'Bez omezení',
    createToken: 'Vytvořit token',
    creating: 'Vytvářím…',
    tokenCreatedTitle: (name: string) => `Token „${name}" — zkopíruj ho teď, znovu ho neuvidíš:`,
    tokenLabel: 'Token',
    tokenCommandLabel: 'Příkaz pro Claude Code',
    tokenJsonLabel: 'Konfigurace pro ostatní klienty (mcp.json)',
    done: 'Hotovo, zkopírováno',

    // Connection lists
    myTitle: 'Moje připojení',
    myEmpty: 'Zatím nemáš připojeného žádného asistenta.',
    orgTitle: 'Všechna připojení v organizaci',
    orgIntro: 'Jen pro adminy. Odpojení platí okamžitě.',
    orgEmpty: 'V organizaci zatím nikdo nemá připojeného asistenta.',
    kindOauth: 'OAuth',
    kindPersonal: 'Token',
    connectedAt: (d: string) => `připojeno ${d}`,
    lastUsed: (d: string) => `naposledy ${d}`,
    neverUsed: 'zatím nepoužito',
    expires: (d: string) => `platí do ${d}`,
    noExpiry: 'bez expirace',
    disconnect: 'Odpojit',
    disconnectTitle: (name: string) => `Odpojit „${name}"?`,
    disconnectMessage:
      'Asistent okamžitě ztratí přístup. Pro opětovné připojení bude potřeba nová autorizace nebo nový token.',
    disconnected: 'Odpojeno',

    // Verify
    verify: 'Vyzkoušet token',
    verifying: 'Zkouším…',
    verifyOk: (n: number) => `✓ Funguje — asistent uvidí ${n} nástrojů.`,
    verifyFail: (e: string) => `✗ Nepodařilo se připojit: ${e}`,

    // Tools
    toolsTitle: 'Co asistent umí',
    toolsIntro:
      'Nástroje, které asistent dostane. Zápisové fungují jen u připojení s právem zápisu a vždy jen v rozsahu tvé role.',
    toolsRead: (n: number) => `Čtení (${n})`,
    toolsWrite: (n: number) => `Zápis (${n})`,

    // History
    historyTitle: 'Historie',
    historyOrgTitle: 'Historie v organizaci',
    historyEmpty: 'Zatím žádné záznamy.',
    eventConnected: 'připojen asistent',
    eventTokenCreated: 'vytvořen token',
    eventRevoked: 'odpojeno',
    eventBy: (name: string) => `provedl(a) ${name}`,
  },
  en: {
    title: 'AI assistants (MCP)',
    intro:
      'Connect Inventory Hub to your AI assistant (Claude, ChatGPT, Cursor, a custom agent…) via the Model Context Protocol. The assistant can then search assets, create loans and more — always limited to your role.',

    connectTitle: 'Connect by signing in (recommended)',
    connectIntro:
      'For clients that support OAuth (Claude Desktop/Code, claude.ai, ChatGPT…). Enter the connector URL; the client opens a browser, you sign in and choose read-only or read-write access.',
    connectorUrlLabel: 'Connector URL',
    claudeCodeLabel: 'Command for Claude Code',
    googleWarn:
      'MCP sign-in uses Google OAuth, which is not configured on this server. Use a personal token below instead.',

    tokenTitle: 'Personal token',
    tokenIntro:
      'For agents and scripts that cannot do OAuth. The token is sent as Authorization: Bearer … and acts as you. You will only see it once.',
    tokenNameLabel: 'Name',
    tokenNamePlaceholder: 'e.g. n8n, my agent',
    accessLabel: 'Access',
    accessRead: 'Read only',
    accessReadWrite: 'Read & write',
    expiryLabel: 'Valid for',
    expiryDays: (d: number) => `${d} days`,
    expiryNever: 'No expiry',
    createToken: 'Create token',
    creating: 'Creating…',
    tokenCreatedTitle: (name: string) => `Token "${name}" — copy it now, you won't see it again:`,
    tokenLabel: 'Token',
    tokenCommandLabel: 'Command for Claude Code',
    tokenJsonLabel: 'Config for other clients (mcp.json)',
    done: 'Done, copied',

    myTitle: 'My connections',
    myEmpty: 'No assistant is connected yet.',
    orgTitle: 'All connections in the organization',
    orgIntro: 'Admins only. Disconnecting takes effect immediately.',
    orgEmpty: 'Nobody in the organization has connected an assistant yet.',
    kindOauth: 'OAuth',
    kindPersonal: 'Token',
    connectedAt: (d: string) => `connected ${d}`,
    lastUsed: (d: string) => `last used ${d}`,
    neverUsed: 'not used yet',
    expires: (d: string) => `valid until ${d}`,
    noExpiry: 'no expiry',
    disconnect: 'Disconnect',
    disconnectTitle: (name: string) => `Disconnect "${name}"?`,
    disconnectMessage:
      'The assistant loses access immediately. Reconnecting will need a new authorization or a new token.',
    disconnected: 'Disconnected',

    verify: 'Test token',
    verifying: 'Testing…',
    verifyOk: (n: number) => `✓ Works — the assistant will see ${n} tools.`,
    verifyFail: (e: string) => `✗ Could not connect: ${e}`,

    toolsTitle: 'What the assistant can do',
    toolsIntro:
      'Tools the assistant gets. Write tools only work on read-write connections and always within your role.',
    toolsRead: (n: number) => `Read (${n})`,
    toolsWrite: (n: number) => `Write (${n})`,

    historyTitle: 'History',
    historyOrgTitle: 'Organization history',
    historyEmpty: 'Nothing yet.',
    eventConnected: 'assistant connected',
    eventTokenCreated: 'token created',
    eventRevoked: 'disconnected',
    eventBy: (name: string) => `by ${name}`,
  },
});
