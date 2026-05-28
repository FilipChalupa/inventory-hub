// TODO: Dočasné – tuto routu odebrat před finálním releasem.
// Slouží k rychlému naplnění DB demo daty při lokálním vývoji / ukázkách.
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import type { AppContext } from '../app.js';
import {
  assetEvents,
  assetTypes,
  assets,
  contacts,
  damageReports,
  loanItems,
  loans,
  locations,
  orgSettings,
} from '../db/schema.js';
import { generateAssetCode } from '../lib/asset-code.js';
import { requireAuth } from '../middleware/auth.js';

const TYPES = [
  { name: 'Notebook', codePrefix: 'LAP' },
  { name: 'Monitor', codePrefix: 'MON' },
  { name: 'Tiskárna', codePrefix: 'PRT' },
  { name: 'Telefon', codePrefix: 'PHN' },
  { name: 'Projektor', codePrefix: 'PRJ' },
  { name: 'Tablet', codePrefix: 'TAB' },
  { name: 'Dokovací stanice', codePrefix: 'DOK' },
  { name: 'Klávesnice', codePrefix: 'KEY' },
  { name: 'Sluchátka', codePrefix: 'HDP' },
  { name: 'Server', codePrefix: 'SRV' },
] as const;

// Modelová jména pro každý typ – z nich se generuje pool assetů.
const MODELS: Record<string, string[]> = {
  LAP: [
    'ThinkPad X1 Carbon',
    'MacBook Pro 14" M3',
    'Dell Latitude 7420',
    'HP EliteBook 840',
    'Lenovo ThinkPad T14',
    'MacBook Air 13" M2',
    'Asus ZenBook 14',
    'Dell XPS 13',
  ],
  MON: [
    'Dell U2723QE 27" 4K',
    'LG 27UK850-W 27"',
    'Samsung Odyssey G7',
    'BenQ PD2700U',
    'Dell P2419H',
    'LG UltraFine 24"',
  ],
  PRT: [
    'HP LaserJet Pro 400 M401dn',
    'Brother HL-L2350DW',
    'Canon i-SENSYS LBP623',
    'Epson EcoTank L3260',
  ],
  PHN: ['iPhone 15 Pro', 'Samsung Galaxy S24', 'Google Pixel 8', 'iPhone 13', 'Xiaomi 13T'],
  PRJ: ['Epson EB-W51', 'BenQ TH685', 'Optoma HD146X'],
  TAB: ['iPad Air 11"', 'Samsung Galaxy Tab S9', 'iPad Pro 12.9"', 'Lenovo Tab P12'],
  DOK: ['Dell WD19 Dock', 'CalDigit TS4', 'HP Thunderbolt Dock G4'],
  KEY: ['Logitech MX Keys', 'Keychron K2', 'Apple Magic Keyboard', 'Dell KB216'],
  HDP: ['Sony WH-1000XM5', 'Bose QC45', 'Jabra Evolve2 65', 'Apple AirPods Pro'],
  SRV: ['Dell PowerEdge R740', 'HPE ProLiant DL380', 'Supermicro 1U'],
};

// Strom lokací – rodiče jsou vždy uvedeni před svými potomky.
const LOCATIONS = [
  { key: 'praha', name: 'Kancelář Praha', parent: null },
  { key: 'praha-1', name: 'Patro 1', parent: 'praha' },
  { key: 'praha-2', name: 'Patro 2', parent: 'praha' },
  { key: 'praha-meeting', name: 'Zasedací místnost', parent: 'praha-1' },
  { key: 'praha-it', name: 'IT místnost', parent: 'praha-2' },
  { key: 'serverovna', name: 'Serverovna', parent: 'praha-2' },
  { key: 'brno', name: 'Pobočka Brno', parent: null },
  { key: 'brno-open', name: 'Open space', parent: 'brno' },
  { key: 'brno-meeting', name: 'Zasedačka', parent: 'brno' },
  { key: 'sklad', name: 'Hlavní sklad', parent: null },
  { key: 'sklad-a', name: 'Regál A', parent: 'sklad' },
  { key: 'sklad-b', name: 'Regál B', parent: 'sklad' },
] as const;

const CONTACTS = [
  {
    name: 'Jan Novák',
    email: 'jan.novak@partnerfirma.cz',
    phone: '+420 601 234 567',
    organization: 'Partner Firma s.r.o.',
    note: 'Pravidelný výpůjčitel hardwaru.',
  },
  {
    name: 'Petra Svobodová',
    email: 'petra.svobodova@klient.cz',
    phone: '+420 602 345 678',
    organization: 'Klient a.s.',
    note: null,
  },
  {
    name: 'Martin Dvořák',
    email: 'martin.dvorak@dodavatel.cz',
    phone: '+420 603 456 789',
    organization: 'Dodavatel s.r.o.',
    note: 'Servisní technik.',
  },
  {
    name: 'Lucie Černá',
    email: 'lucie.cerna@agentura.cz',
    phone: '+420 604 567 890',
    organization: 'Kreativní Agentura',
    note: null,
  },
  {
    name: 'Tomáš Procházka',
    email: 'tomas.prochazka@skola.cz',
    phone: '+420 605 678 901',
    organization: 'Střední škola',
    note: 'Zápůjčky na výuku.',
  },
  {
    name: 'Eva Kučerová',
    email: 'eva.kucerova@nezisk.org',
    phone: '+420 606 789 012',
    organization: 'Nezisková organizace',
    note: null,
  },
] as const;

const LOAN_PURPOSES = [
  'Prezentace u zákazníka',
  'Konference',
  'Home office',
  'Školení nových zaměstnanců',
  'Krátkodobá zápůjčka',
  'Testování v terénu',
];

const DAMAGE_DESCRIPTIONS = [
  'Zaseknutý papír poškodil podavací mechanismus.',
  'Prasklý displej po pádu ze stolu.',
  'Nefunkční klávesa, zatékání tekutiny.',
  'Přehřívání a hlučný ventilátor.',
  'Poškozený napájecí konektor.',
  'Rozbité sklo objektivu projektoru.',
] as const;

const DAY = 24 * 60 * 60 * 1000;

// TODO: Dočasné – celý tento soubor smazat jakmile bude seeding řešen jinak.
export const demoRoutes = new Hono<AppContext>().post('/seed', requireAuth('admin'), (c) => {
  const db = c.get('db');
  const user = c.get('user')!;
  const now = new Date();

  // ── 1. Typy assetů (idempotentní dle codePrefix) ───────────────────────
  for (const t of TYPES) {
    db.insert(assetTypes)
      .values({ id: crypto.randomUUID(), name: t.name, codePrefix: t.codePrefix })
      .onConflictDoNothing()
      .run();
  }
  const typeIdByPrefix = new Map<string, string>();
  for (const t of TYPES) {
    const row = db
      .select({ id: assetTypes.id })
      .from(assetTypes)
      .where(eq(assetTypes.codePrefix, t.codePrefix))
      .get();
    if (row) typeIdByPrefix.set(t.codePrefix, row.id);
  }

  const org = db
    .select({ codePrefix: orgSettings.codePrefix })
    .from(orgSettings)
    .where(eq(orgSettings.id, 'singleton'))
    .get();
  const orgCodePrefix = org?.codePrefix ?? null;

  // ── 2. Lokace ──────────────────────────────────────────────────────────
  const locationIdByKey = new Map<string, string>();
  for (const loc of LOCATIONS) {
    const id = crypto.randomUUID();
    const parentId = loc.parent ? (locationIdByKey.get(loc.parent) ?? null) : null;
    db.insert(locations).values({ id, name: loc.name, parentId }).run();
    locationIdByKey.set(loc.key, id);
  }
  const locationIds = [...locationIdByKey.values()];

  // ── 3. Assety ────────────────────────────────────────────────────────────
  function insertAsset(name: string, typeId: string | null, prefix: string): string {
    const code = generateAssetCode(db, prefix, orgCodePrefix);
    const id = crypto.randomUUID();
    const locationId = locationIds[Math.floor(Math.random() * locationIds.length)] ?? null;
    db.insert(assets).values({ id, code, name, typeId, locationId, customFields: {} }).run();
    db.insert(assetEvents)
      .values({ assetId: id, actorUserId: user.id, type: 'created', payload: { source: 'demo' } })
      .run();
    return id;
  }

  const created: string[] = [];
  for (const t of TYPES) {
    const typeId = typeIdByPrefix.get(t.codePrefix) ?? null;
    for (const model of MODELS[t.codePrefix] ?? []) {
      created.push(insertAsset(model, typeId, t.codePrefix));
    }
  }

  // Vyzvedne N dosud nepoužitých assetů (aby se jeden nepřiřadil a zároveň
  // nepůjčil/nepoškodil).
  const usedAssetIds = new Set<string>();
  function takeFreeAssets(n: number): string[] {
    const free = created.filter((id) => !usedAssetIds.has(id));
    const out: string[] = [];
    for (let i = 0; i < n && free.length > 0; i++) {
      const idx = Math.floor(Math.random() * free.length);
      const picked = free.splice(idx, 1)[0];
      if (!picked) break;
      usedAssetIds.add(picked);
      out.push(picked);
    }
    return out;
  }

  // ── 4. Přiřazení části assetů aktuálnímu uživateli ────────────────────
  const assignedAssets = takeFreeAssets(6);
  for (const assetId of assignedAssets) {
    db.update(assets)
      .set({ assignedToUserId: user.id, status: 'assigned', updatedAt: now })
      .where(eq(assets.id, assetId))
      .run();
    db.insert(assetEvents)
      .values({ assetId, actorUserId: user.id, type: 'assigned', payload: { userId: user.id } })
      .run();
  }

  // ── 5. Kontakty ──────────────────────────────────────────────────────────
  const contactIds: string[] = [];
  for (const ct of CONTACTS) {
    const id = crypto.randomUUID();
    db.insert(contacts)
      .values({
        id,
        name: ct.name,
        email: ct.email,
        phone: ct.phone,
        organization: ct.organization,
        note: ct.note,
      })
      .run();
    contactIds.push(id);
  }

  // ── 6. Výpůjčky (část po splatnosti) ──────────────────────────────────
  let loansCreated = 0;
  for (let i = 0; i < 6; i++) {
    const items = takeFreeAssets(1 + Math.floor(Math.random() * 3)); // 1–3 položky
    if (items.length === 0) break;
    const contactIdx = i % CONTACTS.length;
    const contactId = contactIds[contactIdx];
    const borrowerName = CONTACTS[contactIdx]?.name ?? 'Neznámý';
    // Sudé budou po splatnosti (datum v minulosti), liché ještě běžící.
    const daysOffset = i % 2 === 0 ? -(2 + i) : 7 + i * 2;
    const expectedReturnAt = new Date(now.getTime() + daysOffset * DAY);
    const loanId = crypto.randomUUID();
    db.transaction((tx) => {
      tx.insert(loans)
        .values({
          id: loanId,
          borrowerName,
          borrowerContactId: contactId ?? null,
          purpose: LOAN_PURPOSES[i % LOAN_PURPOSES.length] ?? null,
          expectedReturnAt,
          createdByUserId: user.id,
        })
        .run();
      for (const assetId of items) {
        tx.insert(loanItems).values({ id: crypto.randomUUID(), loanId, assetId }).run();
        tx.update(assets)
          .set({ status: 'on_loan', updatedAt: now })
          .where(eq(assets.id, assetId))
          .run();
        tx.insert(assetEvents)
          .values({
            assetId,
            actorUserId: user.id,
            type: 'loan_started',
            payload: { loanId, borrower: borrowerName },
          })
          .run();
      }
    });
    loansCreated++;
  }

  // ── 7. Hlášení poškození ──────────────────────────────────────────────
  const SEVERITIES = ['minor', 'major', 'total'] as const;
  let damageReportsCreated = 0;
  for (let i = 0; i < 5; i++) {
    const [assetId] = takeFreeAssets(1);
    if (!assetId) break;
    const severity = SEVERITIES[i % SEVERITIES.length] ?? 'major';
    // minor → jen poškozeno, major/total → posíláme do opravy.
    const nextStatus = severity === 'minor' ? 'damaged' : 'in_repair';
    const damageId = crypto.randomUUID();
    const occurredAt = new Date(now.getTime() - (2 + i) * DAY);
    db.insert(damageReports)
      .values({
        id: damageId,
        assetId,
        occurredAt,
        reportedByUserId: user.id,
        description: DAMAGE_DESCRIPTIONS[i % DAMAGE_DESCRIPTIONS.length] ?? 'Poškození.',
        severity,
      })
      .run();
    db.update(assets).set({ status: nextStatus, updatedAt: now }).where(eq(assets.id, assetId)).run();
    db.insert(assetEvents)
      .values({
        assetId,
        actorUserId: user.id,
        type: 'damage_reported',
        payload: { damageReportId: damageId, severity },
      })
      .run();
    if (nextStatus === 'in_repair') {
      db.insert(assetEvents)
        .values({
          assetId,
          actorUserId: user.id,
          type: 'repair_started',
          payload: { reason: 'damage', damageReportId: damageId },
        })
        .run();
    }
    damageReportsCreated++;
  }

  return c.json({
    ok: true,
    summary: {
      assetTypesEnsured: TYPES.length,
      locationsCreated: LOCATIONS.length,
      assetsCreated: created.length,
      contactsCreated: CONTACTS.length,
      loansCreated,
      damageReportsCreated,
    },
  });
});
