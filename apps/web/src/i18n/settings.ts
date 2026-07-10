import { ns } from './util.js';

export const settings = ns({
  cs: {
    // Page + org settings
    title: 'Nastavení organizace',
    orgNameLabel: 'Název organizace',
    orgNameRequired: 'Název organizace je povinný',
    codePrefixLabel: 'Prefix kódu assetů (volitelné, např. ACME)',
    codePrefixError: 'Prefix musí mít 2–6 znaků (A–Z, 0–9)',
    settingsSaved: 'Nastavení uloženo.',
    saveSettings: 'Uložit nastavení',

    // Allowed domains
    allowedDomainsTitle: 'Povolené domény (Google auto-join)',
    allowedDomainsExactNote1: 'Exact match — ',
    allowedDomainsExactNote2: ' NEPOKRYJE ',
    allowedDomainsExactNote3: '. Subdomény přidávej zvlášť.',
    allowedDomainsEmpty: 'Žádné domény nejsou povoleny.',
    domainLabel: 'Doména',
    defaultRoleLabel: 'Default role',

    // CSV export
    exportTitle: 'Export CSV',
    exportNote: 'Stáhne aktuální data ve formátu CSV (UTF-8 + BOM, otevíratelné v Excelu).',
    exportAssets: 'Assety',
    exportLoans: 'Výpůjčky',
    exportDamages: 'Poškození',
    exportContacts: 'Kontakty',

    // Calendar feed (.ics)
    calendarTitle: 'Kalendář výpůjček (.ics)',
    calendarIntro1:
      'Odebírej termíny vrácení a začátky rezervací v Google / Apple kalendáři. Vytvoř odkaz a vlož ho jako „odebíraný kalendář". Odkaz obsahuje token — ber ho jako heslo. Umožní ',
    calendarIntroReadOnly: 'jen čtení',
    calendarIntro2:
      ' termínů výpůjček, k API ani datům se s ním nedostaneš. Token uvidíš jen jednou; zrušením odkazu odběr okamžitě přestane fungovat.',
    calendarCreatedTitle: (name: string) =>
      `Odkaz „${name}" — zkopíruj teď (uvidíš ho jen jednou):`,
    calendarCreatedHint:
      'Vlož jako odebíraný kalendář v Google / Apple kalendáři (URL veřejné adresy).',
    copiedDone: 'Mám zkopírováno',
    linkNameLabel: 'Název odkazu',
    linkNamePlaceholder: 'např. Můj telefon',
    creating: 'Vytvářím…',
    createLink: 'Vytvořit odkaz',
    calendarLinksEmpty: 'Zatím žádné kalendářové odkazy.',
    cancelLinkTitle: (name: string) => `Zrušit odkaz „${name}"?`,
    cancelLinkMessage: 'Odběr kalendáře okamžitě přestane fungovat.',
    cancelLinkConfirm: 'Zrušit odkaz',
    cancelLinkButton: 'Zrušit',
    linkCancelled: 'Odkaz zrušen',

    // Shared key list metadata
    neverUsed: 'nepoužitý',
    lastUsed: (date: string) => `naposledy ${date}`,
    validUntil: (date: string) => `platí do ${date}`,

    // Expiry field
    expiryLabel: 'Platí do (volitelné)',

    // API keys
    apiKeysTitle: 'API klíče',
    apiDocsLink: 'dokumentace API →',
    apiKeysIntro1: 'Pro integrace a skripty. Klíč se posílá jako ',
    apiKeysIntro2:
      ' a má práva admina, který ho vytvořil. Pro odběr kalendáře použij sekci výše. Token uvidíš jen jednou.',
    apiKeyCreatedTitle: (name: string) => `Nový klíč „${name}" — zkopíruj teď:`,
    keyNameLabel: 'Název klíče',
    keyNamePlaceholder: 'např. Zapier',
    createKey: 'Vytvořit klíč',
    apiKeysEmpty: 'Zatím žádné klíče.',
    cancelKeyTitle: (name: string) => `Zrušit klíč „${name}"?`,
    cancelKeyMessage: 'Klíč přestane okamžitě fungovat.',
    cancelKeyConfirm: 'Zrušit klíč',
    keyCancelled: 'Klíč zrušen',

    // Scope labels (keep keys 'api'/'feeds' literal)
    scopeApi: 'API',
    scopeFeeds: 'Kalendář',

    // MCP connection
    mcpTitle: 'Připojení AI asistenta (MCP)',
    mcpIntro:
      'Inventory Hub umí svá data zpřístupnit AI asistentům (Claude Desktop/Code, claude.ai) přes Model Context Protocol. Připojení se nastavuje v MCP klientovi, ne tady — níže je hotový příkaz k vložení.',
    mcpGoogleWarn1: '⚠ Přihlášení k MCP jede přes Google OAuth, který teď není nakonfigurovaný (',
    mcpGoogleWarn2: '). Konektor zatím nepůjde autorizovat — viz README → „Remote MCP server".',
    mcpConnectorUrlLabel: 'URL konektoru',
    mcpCommandLabel: 'Příkaz pro Claude Code',
    mcpFooter1: 'Při prvním použití klient otevře prohlížeč k přihlášení. Pak zvolíš ',
    mcpFooterReadWrite: 'read-write',
    mcpFooter2: ' (zdědí tvoji roli a oprávnění) nebo ',
    mcpFooterReadOnly: 'read-only',
    mcpFooter3:
      ' (jen čtení). Nástroje kopírují REST API — assety, výpůjčky, kontakty, poškození, lokace, typy a (pro adminy) správu organizace.',

    // Invitations
    invitationsTitle: 'Pozvánky uživatelů',
    invitationsIntro:
      'Pozvaný uživatel dostane e-mail s odkazem (v dev módu se e-mail vypíše do konzole serveru). Pokud má SMTP nakonfigurovaný, doručí se reálně.',
    emailLabel: 'E-mail',
    emailPlaceholder: 'kolega@firma.cz',
    invite: 'Pozvat',
    invitationCreated: 'Pozvánka vytvořena. Odkaz:',
    invitationsEmpty: 'Žádné čekající pozvánky.',
    invitationMeta: (role: string, expiry: string) => `role ${role} · platí do ${expiry}`,
    cancelInvitationButton: 'Zrušit',

    // Allowed domains editor
    removeDomain: 'Odebrat',
    addDomain: 'Přidat',
  },
  en: {
    // Page + org settings
    title: 'Organization settings',
    orgNameLabel: 'Organization name',
    orgNameRequired: 'Organization name is required',
    codePrefixLabel: 'Asset code prefix (optional, e.g. ACME)',
    codePrefixError: 'Prefix must be 2–6 characters (A–Z, 0–9)',
    settingsSaved: 'Settings saved.',
    saveSettings: 'Save settings',

    // Allowed domains
    allowedDomainsTitle: 'Allowed domains (Google auto-join)',
    allowedDomainsExactNote1: 'Exact match — ',
    allowedDomainsExactNote2: ' does NOT cover ',
    allowedDomainsExactNote3: '. Add subdomains separately.',
    allowedDomainsEmpty: 'No domains are allowed.',
    domainLabel: 'Domain',
    defaultRoleLabel: 'Default role',

    // CSV export
    exportTitle: 'CSV export',
    exportNote: 'Downloads current data as CSV (UTF-8 + BOM, openable in Excel).',
    exportAssets: 'Assets',
    exportLoans: 'Loans',
    exportDamages: 'Damages',
    exportContacts: 'Contacts',

    // Calendar feed (.ics)
    calendarTitle: 'Loan calendar (.ics)',
    calendarIntro1:
      'Subscribe to return dates and reservation starts in Google / Apple Calendar. Create a link and add it as a "subscribed calendar". The link contains a token — treat it like a password. It grants ',
    calendarIntroReadOnly: 'read-only',
    calendarIntro2:
      ' access to loan dates; it cannot reach the API or your data. You will see the token only once; cancelling the link stops the subscription immediately.',
    calendarCreatedTitle: (name: string) =>
      `Link "${name}" — copy it now (you will see it only once):`,
    calendarCreatedHint: 'Add it as a subscribed calendar in Google / Apple Calendar (public URL).',
    copiedDone: 'Copied',
    linkNameLabel: 'Link name',
    linkNamePlaceholder: 'e.g. My phone',
    creating: 'Creating…',
    createLink: 'Create link',
    calendarLinksEmpty: 'No calendar links yet.',
    cancelLinkTitle: (name: string) => `Cancel link "${name}"?`,
    cancelLinkMessage: 'The calendar subscription will stop working immediately.',
    cancelLinkConfirm: 'Cancel link',
    cancelLinkButton: 'Cancel',
    linkCancelled: 'Link cancelled',

    // Shared key list metadata
    neverUsed: 'never used',
    lastUsed: (date: string) => `last used ${date}`,
    validUntil: (date: string) => `valid until ${date}`,

    // Expiry field
    expiryLabel: 'Valid until (optional)',

    // API keys
    apiKeysTitle: 'API keys',
    apiDocsLink: 'API documentation →',
    apiKeysIntro1: 'For integrations and scripts. The key is sent as ',
    apiKeysIntro2:
      ' and has the rights of the admin who created it. To subscribe to the calendar use the section above. You will see the token only once.',
    apiKeyCreatedTitle: (name: string) => `New key "${name}" — copy it now:`,
    keyNameLabel: 'Key name',
    keyNamePlaceholder: 'e.g. Zapier',
    createKey: 'Create key',
    apiKeysEmpty: 'No keys yet.',
    cancelKeyTitle: (name: string) => `Cancel key "${name}"?`,
    cancelKeyMessage: 'The key will stop working immediately.',
    cancelKeyConfirm: 'Cancel key',
    keyCancelled: 'Key cancelled',

    // Scope labels (keep keys 'api'/'feeds' literal)
    scopeApi: 'API',
    scopeFeeds: 'Calendar',

    // MCP connection
    mcpTitle: 'AI assistant connection (MCP)',
    mcpIntro:
      'Inventory Hub can expose its data to AI assistants (Claude Desktop/Code, claude.ai) over the Model Context Protocol. The connection is set up in the MCP client, not here — below is a ready-to-paste command.',
    mcpGoogleWarn1: '⚠ MCP sign-in uses Google OAuth, which is not configured right now (',
    mcpGoogleWarn2: '). The connector cannot be authorized yet — see README → "Remote MCP server".',
    mcpConnectorUrlLabel: 'Connector URL',
    mcpCommandLabel: 'Command for Claude Code',
    mcpFooter1: 'On first use the client opens a browser to sign in. Then you choose ',
    mcpFooterReadWrite: 'read-write',
    mcpFooter2: ' (inherits your role and permissions) or ',
    mcpFooterReadOnly: 'read-only',
    mcpFooter3:
      ' (read only). The tools mirror the REST API — assets, loans, contacts, damages, locations, types and (for admins) organization management.',

    // Invitations
    invitationsTitle: 'User invitations',
    invitationsIntro:
      'The invited user receives an email with a link (in dev mode the email is printed to the server console). If SMTP is configured, it is delivered for real.',
    emailLabel: 'Email',
    emailPlaceholder: 'colleague@company.com',
    invite: 'Invite',
    invitationCreated: 'Invitation created. Link:',
    invitationsEmpty: 'No pending invitations.',
    invitationMeta: (role: string, expiry: string) => `role ${role} · valid until ${expiry}`,
    cancelInvitationButton: 'Cancel',

    // Allowed domains editor
    removeDomain: 'Remove',
    addDomain: 'Add',
  },
});
