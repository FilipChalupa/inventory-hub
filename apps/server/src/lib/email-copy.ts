import type { Email } from './email.js';

/**
 * Central, localized copy for every outbound email. The whole web app is
 * bilingual (cs/en); this keeps the emails in step. Locale is org-wide
 * (EMAIL_LOCALE env) — recipients include external borrowers/invitees with no
 * account, so a per-user preference wouldn't cover them anyway.
 *
 * Builders are pure: callers pass already-formatted dates and URLs, and each
 * builder returns a ready-to-send { subject, text }. Keep both locales in sync
 * when adding a template.
 */
export type EmailLocale = 'cs' | 'en';

type Line = string | false | null | undefined;
/** Joins body lines, dropping blanks/falsy so optional lines can be inlined. */
function body(lines: Line[]): string {
  return lines.filter((l): l is string => typeof l === 'string' && l !== '').join('\n');
}

type Role = 'admin' | 'operator' | 'member' | 'auditor';

export type InvitationParams = {
  inviterName: string;
  inviterEmail: string;
  role: Role;
  acceptUrl: string;
};
export type ReservationApprovedParams = {
  name: string;
  itemCount: number;
  period: string;
  detailUrl?: string;
};
export type ReservationRejectedParams = {
  name: string;
  itemCount: number;
  newRequestUrl?: string;
};
export type OverdueBorrowerParams = {
  borrowerName: string;
  dueDate: string;
  purpose?: string | null;
  detailUrl?: string;
};
export type OverdueDigestParams = {
  adminName: string;
  items: { borrowerName: string; expected: string; idShort: string }[];
  loansUrl?: string;
};
export type StartBorrowerParams = {
  borrowerName: string;
  startDate: string;
  purpose?: string | null;
  itemCount: number;
  detailUrl?: string;
};
export type StartDigestParams = {
  adminName: string;
  items: { borrowerName: string; start: string; itemCount: number }[];
  loansUrl?: string;
};
export type ServiceDigestParams = {
  adminName: string;
  windowDays: number;
  items: { code: string; name: string; due: string }[];
  assetsUrl?: string;
};
export type WarrantyDigestParams = {
  adminName: string;
  windowDays: number;
  items: { code: string; name: string; until: string }[];
  assetsUrl?: string;
};
export type WeeklyReportParams = {
  adminName: string;
  totalActive: number;
  totalValue: string;
  openLoans: number;
  overdueLoans: number;
  dashboardUrl?: string;
};
export type AssetAssignedParams = {
  name: string;
  assetCode: string;
  assetName: string;
  detailUrl?: string;
};

export type AgentConnectedParams = {
  name: string;
  agentName: string;
  kind: 'oauth' | 'personal';
  readWrite: boolean;
  manageUrl?: string;
};
export type InventoryClosedParams = {
  adminName: string;
  sessionName: string;
  closedBy: string;
  counts: { expected: number; found: number; missing: number; unexpected: number };
  /** Already truncated by the caller; `more*` say how many were left out. */
  missing: { code: string; name: string }[];
  moreMissing: number;
  unexpected: { code: string; name: string }[];
  moreUnexpected: number;
  sessionUrl?: string;
  csvUrl?: string;
};
export type AgentReuseRevokedParams = { name: string; agentName: string; manageUrl?: string };
export type McpTokensExpiringParams = {
  name: string;
  items: { name: string; expires: string }[];
  manageUrl?: string;
};

export type EmailCopy = {
  invitation(p: InvitationParams): Email & { to: string };
  reservationApproved(p: ReservationApprovedParams): Pick<Email, 'subject' | 'text'>;
  reservationRejected(p: ReservationRejectedParams): Pick<Email, 'subject' | 'text'>;
  overdueBorrower(p: OverdueBorrowerParams): Pick<Email, 'subject' | 'text'>;
  overdueDigest(p: OverdueDigestParams): Pick<Email, 'subject' | 'text'>;
  startBorrower(p: StartBorrowerParams): Pick<Email, 'subject' | 'text'>;
  startDigest(p: StartDigestParams): Pick<Email, 'subject' | 'text'>;
  serviceDigest(p: ServiceDigestParams): Pick<Email, 'subject' | 'text'>;
  warrantyDigest(p: WarrantyDigestParams): Pick<Email, 'subject' | 'text'>;
  weeklyReport(p: WeeklyReportParams): Pick<Email, 'subject' | 'text'>;
  assetAssigned(p: AssetAssignedParams): Pick<Email, 'subject' | 'text'>;
  agentConnected(p: AgentConnectedParams): Pick<Email, 'subject' | 'text'>;
  mcpTokensExpiring(p: McpTokensExpiringParams): Pick<Email, 'subject' | 'text'>;
  agentReuseRevoked(p: AgentReuseRevokedParams): Pick<Email, 'subject' | 'text'>;
  inventoryClosed(p: InventoryClosedParams): Pick<Email, 'subject' | 'text'>;
};

const ROLE_CS: Record<Role, string> = {
  admin: 'administrátor',
  operator: 'operátor',
  member: 'člen',
  auditor: 'auditor',
};
const ROLE_EN: Record<Role, string> = {
  admin: 'admin',
  operator: 'operator',
  member: 'member',
  auditor: 'auditor',
};

const cs: EmailCopy = {
  invitation: (p) => ({
    to: '',
    subject: 'Pozvánka do Inventory Hub',
    text: body([
      'Ahoj!',
      '',
      `${p.inviterName} (${p.inviterEmail}) tě zve do Inventory Hub jako role ${ROLE_CS[p.role]}.`,
      '',
      'Pro přijetí klikni na následující odkaz (platí 7 dní):',
      p.acceptUrl,
      '',
      'Pokud jsi tuto pozvánku nečekal/a, můžeš e-mail ignorovat.',
    ]),
  }),
  reservationApproved: (p) => ({
    subject: 'Inventory Hub: rezervace schválena',
    text: body([
      `Ahoj ${p.name},`,
      '',
      `tvoje žádost o výpůjčku (${p.itemCount} ks) byla schválena.`,
      `Termín: ${p.period}`,
      '',
      p.detailUrl && `Detail: ${p.detailUrl}`,
      '',
      'Až si věci vyzvedneš, obsluha výpůjčku zahájí.',
    ]),
  }),
  reservationRejected: (p) => ({
    subject: 'Inventory Hub: rezervace zamítnuta',
    text: body([
      `Ahoj ${p.name},`,
      '',
      `tvoje žádost o výpůjčku (${p.itemCount} ks) byla bohužel zamítnuta.`,
      '',
      p.newRequestUrl && `Podat novou žádost: ${p.newRequestUrl}`,
    ]),
  }),
  overdueBorrower: (p) => ({
    subject: 'Připomenutí: vrácení vypůjčených předmětů',
    text: body([
      `Ahoj ${p.borrowerName},`,
      '',
      `výpůjčka s očekávaným vrácením ${p.dueDate} je již po termínu.`,
      p.purpose && `Účel: ${p.purpose}`,
      '',
      p.detailUrl && `Detail výpůjčky: ${p.detailUrl}`,
      '',
      'Děkujeme za vrácení co nejdříve.',
    ]),
  }),
  overdueDigest: (p) => ({
    subject: `Inventory Hub: ${p.items.length} výpůjček po termínu`,
    text: body([
      `Ahoj ${p.adminName},`,
      '',
      `Aktuálně je ${p.items.length} výpůjček po termínu vrácení:`,
      '',
      ...p.items.map((i) => `- ${i.borrowerName}: očekáváno ${i.expected} (id ${i.idShort})`),
      '',
      p.loansUrl && `Přehled výpůjček: ${p.loansUrl}`,
    ]),
  }),
  startBorrower: (p) => ({
    subject: 'Připomenutí: vaše výpůjčka brzy začíná',
    text: body([
      `Ahoj ${p.borrowerName},`,
      '',
      `připomínáme rezervaci se začátkem ${p.startDate}.`,
      p.purpose && `Účel: ${p.purpose}`,
      `Počet položek: ${p.itemCount}`,
      '',
      p.detailUrl && `Detail výpůjčky: ${p.detailUrl}`,
    ]),
  }),
  startDigest: (p) => ({
    subject: `Inventory Hub: ${p.items.length} výpůjček brzy začíná`,
    text: body([
      `Ahoj ${p.adminName},`,
      '',
      `Do 24 hodin začíná ${p.items.length} naplánovaných výpůjček — připrav položky:`,
      '',
      ...p.items.map((i) => `- ${i.borrowerName}: začátek ${i.start}, ${i.itemCount} ks`),
      '',
      p.loansUrl && `Přehled výpůjček: ${p.loansUrl}`,
    ]),
  }),
  serviceDigest: (p) => ({
    subject: `Inventory Hub: ${p.items.length} assetů čeká na servis`,
    text: body([
      `Ahoj ${p.adminName},`,
      '',
      `U ${p.items.length} assetů je do ${p.windowDays} dnů naplánovaný servis (nebo už je po termínu):`,
      '',
      ...p.items.map((i) => `- ${i.code} ${i.name}: servis do ${i.due}`),
      '',
      p.assetsUrl && `Přehled assetů: ${p.assetsUrl}`,
    ]),
  }),
  warrantyDigest: (p) => ({
    subject: `Inventory Hub: ${p.items.length} assetů s končící zárukou`,
    text: body([
      `Ahoj ${p.adminName},`,
      '',
      `U ${p.items.length} assetů končí záruka do ${p.windowDays} dnů (nebo už skončila):`,
      '',
      ...p.items.map((i) => `- ${i.code} ${i.name}: záruka do ${i.until}`),
      '',
      p.assetsUrl && `Přehled assetů: ${p.assetsUrl}`,
    ]),
  }),
  weeklyReport: (p) => ({
    subject: 'Inventory Hub: týdenní přehled inventáře',
    text: body([
      `Ahoj ${p.adminName},`,
      '',
      'týdenní přehled stavu inventáře:',
      '',
      `Aktivních assetů: ${p.totalActive}`,
      `Pořizovací hodnota inventáře: ${p.totalValue}`,
      `Aktivní výpůjčky: ${p.openLoans} (z toho po termínu: ${p.overdueLoans})`,
      '',
      p.dashboardUrl && `Dashboard: ${p.dashboardUrl}`,
    ]),
  }),
  assetAssigned: (p) => ({
    subject: 'Inventory Hub: byl ti přiřazen majetek',
    text: body([
      `Ahoj ${p.name},`,
      '',
      `byl ti přiřazen majetek ${p.assetCode} ${p.assetName}.`,
      '',
      p.detailUrl && `Detail: ${p.detailUrl}`,
    ]),
  }),
  agentConnected: (p) => ({
    subject: `Inventory Hub: připojen AI asistent „${p.agentName}"`,
    text: body([
      `Ahoj ${p.name},`,
      '',
      p.kind === 'oauth'
        ? `k tvému účtu se právě připojil AI asistent „${p.agentName}" (${p.readWrite ? 'čtení i zápis' : 'jen čtení'}).`
        : `pro tvůj účet byl vytvořen osobní MCP token „${p.agentName}" (${p.readWrite ? 'čtení i zápis' : 'jen čtení'}).`,
      'Asistent může pracovat s inventářem tvým jménem.',
      '',
      'Pokud jsi to nebyl(a) ty, připojení hned odpoj:',
      p.manageUrl && p.manageUrl,
    ]),
  }),
  mcpTokensExpiring: (p) => ({
    subject: 'Inventory Hub: brzy vyprší MCP token',
    text: body([
      `Ahoj ${p.name},`,
      '',
      'tyto osobní MCP tokeny brzy vyprší a asistenti, kteří je používají, ztratí přístup:',
      ...p.items.map((i) => `  • ${i.name} — platí do ${i.expires}`),
      '',
      'Nový token vytvoříš na stránce AI asistentů:',
      p.manageUrl && p.manageUrl,
    ]),
  }),
  agentReuseRevoked: (p) => ({
    subject: `Inventory Hub: připojení „${p.agentName}" bylo z bezpečnostních důvodů zrušeno`,
    text: body([
      `Ahoj ${p.name},`,
      '',
      `připojení AI asistenta „${p.agentName}" k tvému účtu jsme zrušili: jeho přístupový token použil ještě někdo jiný, což může znamenat, že unikl.`,
      'Pokud asistenta dál používáš, stačí ho znovu připojit. Zvaž také, kde všude byl přihlášený.',
      '',
      p.manageUrl && `Přehled připojení: ${p.manageUrl}`,
    ]),
  }),
  inventoryClosed: (p) => ({
    subject:
      p.counts.missing > 0
        ? `Inventura „${p.sessionName}" uzavřena — chybí ${p.counts.missing}`
        : `Inventura „${p.sessionName}" uzavřena — vše nalezeno`,
    text: body([
      `Ahoj ${p.adminName},`,
      '',
      `${p.closedBy} uzavřel(a) inventuru „${p.sessionName}".`,
      '',
      `Očekáváno: ${p.counts.expected} · nalezeno: ${p.counts.found} · chybí: ${p.counts.missing} · navíc: ${p.counts.unexpected}`,
      p.missing.length > 0 && '',
      p.missing.length > 0 && 'Chybí:',
      ...p.missing.map((a) => `  • ${a.code} ${a.name}`),
      p.moreMissing > 0 && `  … a dalších ${p.moreMissing}`,
      p.unexpected.length > 0 && '',
      p.unexpected.length > 0 && 'Navíc / mimo rozsah:',
      ...p.unexpected.map((a) => `  • ${a.code} ${a.name}`),
      p.moreUnexpected > 0 && `  … a dalších ${p.moreUnexpected}`,
      '',
      p.sessionUrl && `Detail: ${p.sessionUrl}`,
      p.csvUrl && `Export CSV: ${p.csvUrl}`,
    ]),
  }),
};

const en: EmailCopy = {
  invitation: (p) => ({
    to: '',
    subject: 'Invitation to Inventory Hub',
    text: body([
      'Hi!',
      '',
      `${p.inviterName} (${p.inviterEmail}) invites you to Inventory Hub as ${ROLE_EN[p.role]}.`,
      '',
      'To accept, open the following link (valid for 7 days):',
      p.acceptUrl,
      '',
      "If you weren't expecting this invitation, you can ignore this email.",
    ]),
  }),
  reservationApproved: (p) => ({
    subject: 'Inventory Hub: reservation approved',
    text: body([
      `Hi ${p.name},`,
      '',
      `your loan request (${p.itemCount} pcs) has been approved.`,
      `Period: ${p.period}`,
      '',
      p.detailUrl && `Details: ${p.detailUrl}`,
      '',
      'Once you pick the items up, staff will start the loan.',
    ]),
  }),
  reservationRejected: (p) => ({
    subject: 'Inventory Hub: reservation rejected',
    text: body([
      `Hi ${p.name},`,
      '',
      `your loan request (${p.itemCount} pcs) was unfortunately rejected.`,
      '',
      p.newRequestUrl && `Submit a new request: ${p.newRequestUrl}`,
    ]),
  }),
  overdueBorrower: (p) => ({
    subject: 'Reminder: please return borrowed items',
    text: body([
      `Hi ${p.borrowerName},`,
      '',
      `the loan due for return on ${p.dueDate} is now overdue.`,
      p.purpose && `Purpose: ${p.purpose}`,
      '',
      p.detailUrl && `Loan details: ${p.detailUrl}`,
      '',
      'Please return it as soon as possible. Thank you.',
    ]),
  }),
  overdueDigest: (p) => ({
    subject: `Inventory Hub: ${p.items.length} overdue loans`,
    text: body([
      `Hi ${p.adminName},`,
      '',
      `There are currently ${p.items.length} loans past their return date:`,
      '',
      ...p.items.map((i) => `- ${i.borrowerName}: due ${i.expected} (id ${i.idShort})`),
      '',
      p.loansUrl && `Loans overview: ${p.loansUrl}`,
    ]),
  }),
  startBorrower: (p) => ({
    subject: 'Reminder: your loan starts soon',
    text: body([
      `Hi ${p.borrowerName},`,
      '',
      `a reminder about your reservation starting ${p.startDate}.`,
      p.purpose && `Purpose: ${p.purpose}`,
      `Item count: ${p.itemCount}`,
      '',
      p.detailUrl && `Loan details: ${p.detailUrl}`,
    ]),
  }),
  startDigest: (p) => ({
    subject: `Inventory Hub: ${p.items.length} loans starting soon`,
    text: body([
      `Hi ${p.adminName},`,
      '',
      `${p.items.length} planned loans start within 24 hours — prepare the items:`,
      '',
      ...p.items.map((i) => `- ${i.borrowerName}: starts ${i.start}, ${i.itemCount} pcs`),
      '',
      p.loansUrl && `Loans overview: ${p.loansUrl}`,
    ]),
  }),
  serviceDigest: (p) => ({
    subject: `Inventory Hub: ${p.items.length} assets due for service`,
    text: body([
      `Hi ${p.adminName},`,
      '',
      `${p.items.length} assets have service scheduled within ${p.windowDays} days (or overdue):`,
      '',
      ...p.items.map((i) => `- ${i.code} ${i.name}: service by ${i.due}`),
      '',
      p.assetsUrl && `Assets overview: ${p.assetsUrl}`,
    ]),
  }),
  warrantyDigest: (p) => ({
    subject: `Inventory Hub: ${p.items.length} assets with ending warranty`,
    text: body([
      `Hi ${p.adminName},`,
      '',
      `${p.items.length} assets have their warranty ending within ${p.windowDays} days (or already ended):`,
      '',
      ...p.items.map((i) => `- ${i.code} ${i.name}: warranty until ${i.until}`),
      '',
      p.assetsUrl && `Assets overview: ${p.assetsUrl}`,
    ]),
  }),
  weeklyReport: (p) => ({
    subject: 'Inventory Hub: weekly inventory summary',
    text: body([
      `Hi ${p.adminName},`,
      '',
      'weekly inventory status:',
      '',
      `Active assets: ${p.totalActive}`,
      `Inventory purchase value: ${p.totalValue}`,
      `Active loans: ${p.openLoans} (overdue: ${p.overdueLoans})`,
      '',
      p.dashboardUrl && `Dashboard: ${p.dashboardUrl}`,
    ]),
  }),
  assetAssigned: (p) => ({
    subject: 'Inventory Hub: an asset was assigned to you',
    text: body([
      `Hi ${p.name},`,
      '',
      `the asset ${p.assetCode} ${p.assetName} has been assigned to you.`,
      '',
      p.detailUrl && `Details: ${p.detailUrl}`,
    ]),
  }),
  agentConnected: (p) => ({
    subject: `Inventory Hub: AI assistant "${p.agentName}" connected`,
    text: body([
      `Hi ${p.name},`,
      '',
      p.kind === 'oauth'
        ? `the AI assistant "${p.agentName}" was just connected to your account (${p.readWrite ? 'read & write' : 'read only'}).`
        : `a personal MCP token "${p.agentName}" was created for your account (${p.readWrite ? 'read & write' : 'read only'}).`,
      'The assistant can work with the inventory on your behalf.',
      '',
      "If this wasn't you, disconnect it right away:",
      p.manageUrl && p.manageUrl,
    ]),
  }),
  mcpTokensExpiring: (p) => ({
    subject: 'Inventory Hub: an MCP token expires soon',
    text: body([
      `Hi ${p.name},`,
      '',
      'these personal MCP tokens expire soon and the assistants using them will lose access:',
      ...p.items.map((i) => `  • ${i.name} — valid until ${i.expires}`),
      '',
      'Create a new token on the AI assistants page:',
      p.manageUrl && p.manageUrl,
    ]),
  }),
  agentReuseRevoked: (p) => ({
    subject: `Inventory Hub: connection "${p.agentName}" was revoked for security`,
    text: body([
      `Hi ${p.name},`,
      '',
      `we revoked the AI assistant "${p.agentName}" connected to your account: its access token was used by someone else too, which may mean it leaked.`,
      'If you still use the assistant, just connect it again. Also consider where it was signed in.',
      '',
      p.manageUrl && `Your connections: ${p.manageUrl}`,
    ]),
  }),
  inventoryClosed: (p) => ({
    subject:
      p.counts.missing > 0
        ? `Stock-take "${p.sessionName}" closed — ${p.counts.missing} missing`
        : `Stock-take "${p.sessionName}" closed — everything found`,
    text: body([
      `Hi ${p.adminName},`,
      '',
      `${p.closedBy} closed the stock-take "${p.sessionName}".`,
      '',
      `Expected: ${p.counts.expected} · found: ${p.counts.found} · missing: ${p.counts.missing} · extra: ${p.counts.unexpected}`,
      p.missing.length > 0 && '',
      p.missing.length > 0 && 'Missing:',
      ...p.missing.map((a) => `  • ${a.code} ${a.name}`),
      p.moreMissing > 0 && `  … and ${p.moreMissing} more`,
      p.unexpected.length > 0 && '',
      p.unexpected.length > 0 && 'Extra / out of scope:',
      ...p.unexpected.map((a) => `  • ${a.code} ${a.name}`),
      p.moreUnexpected > 0 && `  … and ${p.moreUnexpected} more`,
      '',
      p.sessionUrl && `Details: ${p.sessionUrl}`,
      p.csvUrl && `CSV export: ${p.csvUrl}`,
    ]),
  }),
};

const CATALOG: Record<EmailLocale, EmailCopy> = { cs, en };

/** Returns the email copy builders for the given locale (defaults to Czech). */
export function emailCopy(locale: EmailLocale | undefined): EmailCopy {
  return CATALOG[locale ?? 'cs'] ?? cs;
}
