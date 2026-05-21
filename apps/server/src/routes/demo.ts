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

// TODO: Dočasné – celý tento soubor smazat jakmile bude seeding řešen jinak.
export const demoRoutes = new Hono<AppContext>().post(
  '/seed',
  requireAuth('admin'),
  (c) => {
    const db = c.get('db');
    const user = c.get('user')!;

    // ── 1. Typy assetů ────────────────────────────────────────────────────
    // onConflictDoNothing zajišťuje idempotenci – pokud typ s daným prefixem
    // už existuje (třeba ze seedu), přeskočí ho.
    const TYPES = [
      { name: 'Notebook', codePrefix: 'LAP' },
      { name: 'Monitor', codePrefix: 'MON' },
      { name: 'Tiskárna', codePrefix: 'PRT' },
      { name: 'Telefon', codePrefix: 'PHN' },
      { name: 'Projektor', codePrefix: 'PRJ' },
    ] as const;

    for (const t of TYPES) {
      db.insert(assetTypes)
        .values({ id: crypto.randomUUID(), name: t.name, codePrefix: t.codePrefix })
        .onConflictDoNothing()
        .run();
    }

    // Načti skutečná ID typů (mohla být vytvořena dřív, nebo právě teď)
    const typeMap = new Map<string, string>(); // codePrefix → id
    for (const t of TYPES) {
      const row = db
        .select({ id: assetTypes.id })
        .from(assetTypes)
        .where(eq(assetTypes.codePrefix, t.codePrefix))
        .get();
      if (row) typeMap.set(t.codePrefix, row.id);
    }

    const lapId = typeMap.get('LAP') ?? null;
    const monId = typeMap.get('MON') ?? null;
    const prtId = typeMap.get('PRT') ?? null;
    const phnId = typeMap.get('PHN') ?? null;
    const prjId = typeMap.get('PRJ') ?? null;

    // ── 2. Lokace ──────────────────────────────────────────────────────────
    // Vždy vytváří nové záznamy (lokace nemají unikátní klíč kromě id).
    const org = db
      .select({ codePrefix: orgSettings.codePrefix })
      .from(orgSettings)
      .where(eq(orgSettings.id, 'singleton'))
      .get();
    const orgCodePrefix = org?.codePrefix ?? null;

    const officeId = crypto.randomUUID();
    const floor1Id = crypto.randomUUID();
    const meetingRoomId = crypto.randomUUID();
    const storageId = crypto.randomUUID();

    db.insert(locations).values({ id: officeId, name: 'Kancelář Praha', parentId: null }).run();
    db.insert(locations)
      .values({ id: floor1Id, name: 'Patro 1', parentId: officeId })
      .run();
    db.insert(locations)
      .values({ id: meetingRoomId, name: 'Zasedací místnost', parentId: officeId })
      .run();
    db.insert(locations).values({ id: storageId, name: 'Sklad', parentId: null }).run();

    // ── 3. Assety ──────────────────────────────────────────────────────────
    // Kódy se generují automaticky dle aktuálního stavu DB – nikdy kolize.
    function insertAsset(
      name: string,
      typeId: string | null,
      locationId: string | null,
    ): { id: string; code: string } {
      let prefix = 'GEN';
      if (typeId) {
        const t = db
          .select({ codePrefix: assetTypes.codePrefix })
          .from(assetTypes)
          .where(eq(assetTypes.id, typeId))
          .get();
        if (t) prefix = t.codePrefix;
      }
      const code = generateAssetCode(db, prefix, orgCodePrefix);
      const id = crypto.randomUUID();
      db.insert(assets).values({ id, code, name, typeId, locationId, customFields: {} }).run();
      db.insert(assetEvents)
        .values({
          assetId: id,
          actorUserId: user.id,
          type: 'created',
          payload: { source: 'demo' },
        })
        .run();
      return { id, code };
    }

    // Notebooky
    insertAsset('ThinkPad X1 Carbon', lapId, floor1Id);
    const lap2 = insertAsset('MacBook Pro 14" M3', lapId, floor1Id); // bude přiřazeno
    const lap3 = insertAsset('Dell Latitude 7420', lapId, storageId); // bude půjčeno
    // Monitory
    insertAsset('Dell U2723QE 27" 4K', monId, floor1Id);
    insertAsset('LG 27UK850-W 27"', monId, floor1Id);
    // Tiskárna (bude v opravě)
    const prt1 = insertAsset('HP LaserJet Pro 400 M401dn', prtId, floor1Id);
    // Telefony
    insertAsset('iPhone 15 Pro', phnId, storageId);
    insertAsset('Samsung Galaxy S24', phnId, storageId);
    // Projektor
    insertAsset('Epson EB-W51', prjId, meetingRoomId);

    const now = new Date();

    // ── 4. Přiřazení notebooku aktuálnímu uživateli ───────────────────────
    db.update(assets)
      .set({ assignedToUserId: user.id, status: 'assigned', updatedAt: now })
      .where(eq(assets.id, lap2.id))
      .run();
    db.insert(assetEvents)
      .values({
        assetId: lap2.id,
        actorUserId: user.id,
        type: 'assigned',
        payload: { userId: user.id },
      })
      .run();

    // ── 5. Kontakt ────────────────────────────────────────────────────────
    const contactId = crypto.randomUUID();
    db.insert(contacts)
      .values({
        id: contactId,
        name: 'Jan Novák',
        email: 'jan.novak@partnerfirma.cz',
        phone: '+420 601 234 567',
        organization: 'Partner Firma s.r.o.',
        note: 'Pravidelný výpůjčitel hardwaru.',
      })
      .run();

    // ── 6. Výpůjčka (notebook → Jan Novák) ───────────────────────────────
    const loanId = crypto.randomUUID();
    const expectedReturnAt = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    db.transaction((tx) => {
      tx.insert(loans)
        .values({
          id: loanId,
          borrowerName: 'Jan Novák',
          borrowerContactId: contactId,
          purpose: 'Prezentace u zákazníka',
          expectedReturnAt,
          createdByUserId: user.id,
        })
        .run();
      tx.insert(loanItems)
        .values({ id: crypto.randomUUID(), loanId, assetId: lap3.id })
        .run();
      tx.update(assets)
        .set({ status: 'on_loan', updatedAt: now })
        .where(eq(assets.id, lap3.id))
        .run();
      tx.insert(assetEvents)
        .values({
          assetId: lap3.id,
          actorUserId: user.id,
          type: 'loan_started',
          payload: { loanId, borrower: 'Jan Novák' },
        })
        .run();
    });

    // ── 7. Hlášení poškození (tiskárna → in_repair) ───────────────────────
    const damageId = crypto.randomUUID();
    const occurredAt = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000); // před 3 dny
    db.insert(damageReports)
      .values({
        id: damageId,
        assetId: prt1.id,
        occurredAt,
        reportedByUserId: user.id,
        description:
          'Zaseknutý papír způsobil poškození podavacího mechanismu. Tiskárna nefunguje.',
        severity: 'major',
      })
      .run();
    db.update(assets)
      .set({ status: 'in_repair', updatedAt: now })
      .where(eq(assets.id, prt1.id))
      .run();
    db.insert(assetEvents)
      .values({
        assetId: prt1.id,
        actorUserId: user.id,
        type: 'damage_reported',
        payload: { damageReportId: damageId, severity: 'major' },
      })
      .run();
    db.insert(assetEvents)
      .values({
        assetId: prt1.id,
        actorUserId: user.id,
        type: 'repair_started',
        payload: { reason: 'damage', damageReportId: damageId },
      })
      .run();

    return c.json({
      ok: true,
      summary: {
        assetTypesEnsured: TYPES.length,
        locationsCreated: 4,
        assetsCreated: 9,
        contactsCreated: 1,
        loansCreated: 1,
        damageReportsCreated: 1,
      },
    });
  },
);
