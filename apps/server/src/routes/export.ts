import { Hono } from 'hono';
import { asc, eq } from 'drizzle-orm';
import type { AppContext } from '../app.js';
import {
  assetTypes,
  assets,
  damageReports,
  loanItems,
  loans,
  locations,
} from '../db/schema.js';
import { toCsv } from '../lib/csv.js';

function csvResponse(filename: string, body: string): Response {
  return new Response('﻿' + body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}

export const exportRoutes = new Hono<AppContext>()
  .get('/assets.csv', (c) => {
    const db = c.get('db');
    const rows = db
      .select({
        code: assets.code,
        name: assets.name,
        status: assets.status,
        typeName: assetTypes.name,
        locationName: locations.name,
        archivedAt: assets.archivedAt,
        createdAt: assets.createdAt,
        updatedAt: assets.updatedAt,
        customFields: assets.customFields,
      })
      .from(assets)
      .leftJoin(assetTypes, eq(assetTypes.id, assets.typeId))
      .leftJoin(locations, eq(locations.id, assets.locationId))
      .orderBy(asc(assets.code))
      .all();

    const csv = toCsv(rows, [
      { key: 'code', header: 'Kód' },
      { key: 'name', header: 'Název' },
      { key: 'status', header: 'Stav' },
      { key: 'typeName', header: 'Typ' },
      { key: 'locationName', header: 'Lokace' },
      { key: 'archivedAt', header: 'Archivováno' },
      { key: 'createdAt', header: 'Vytvořeno' },
      { key: 'updatedAt', header: 'Aktualizováno' },
      { key: 'customFields', header: 'Vlastní pole (JSON)' },
    ]);
    return csvResponse(`assets-${todayStamp()}.csv`, csv);
  })
  .get('/loans.csv', (c) => {
    const db = c.get('db');
    const rows = db
      .select({
        loanId: loans.id,
        borrower: loans.borrowerName,
        borrowerContact: loans.borrowerContact,
        purpose: loans.purpose,
        loanedAt: loans.loanedAt,
        expectedReturnAt: loans.expectedReturnAt,
        assetCode: assets.code,
        assetName: assets.name,
        returnedAt: loanItems.returnedAt,
        returnCondition: loanItems.returnCondition,
        returnNotes: loanItems.returnNotes,
      })
      .from(loans)
      .innerJoin(loanItems, eq(loanItems.loanId, loans.id))
      .innerJoin(assets, eq(assets.id, loanItems.assetId))
      .orderBy(asc(loans.loanedAt), asc(assets.code))
      .all();

    const csv = toCsv(rows, [
      { key: 'loanId', header: 'Výpůjčka ID' },
      { key: 'borrower', header: 'Vypůjčující' },
      { key: 'borrowerContact', header: 'Kontakt' },
      { key: 'purpose', header: 'Účel' },
      { key: 'loanedAt', header: 'Zapůjčeno' },
      { key: 'expectedReturnAt', header: 'Očekávaný návrat' },
      { key: 'assetCode', header: 'Asset kód' },
      { key: 'assetName', header: 'Asset název' },
      { key: 'returnedAt', header: 'Vráceno' },
      { key: 'returnCondition', header: 'Stav vrácení' },
      { key: 'returnNotes', header: 'Poznámka' },
    ]);
    return csvResponse(`loans-${todayStamp()}.csv`, csv);
  })
  .get('/damages.csv', (c) => {
    const db = c.get('db');
    const rows = db
      .select({
        assetCode: assets.code,
        assetName: assets.name,
        severity: damageReports.severity,
        description: damageReports.description,
        occurredAt: damageReports.occurredAt,
        reportedAt: damageReports.reportedAt,
        resolvedAt: damageReports.resolvedAt,
      })
      .from(damageReports)
      .innerJoin(assets, eq(assets.id, damageReports.assetId))
      .orderBy(asc(damageReports.occurredAt))
      .all();

    const csv = toCsv(rows, [
      { key: 'assetCode', header: 'Asset kód' },
      { key: 'assetName', header: 'Asset název' },
      { key: 'severity', header: 'Závažnost' },
      { key: 'description', header: 'Popis' },
      { key: 'occurredAt', header: 'Kdy se stalo' },
      { key: 'reportedAt', header: 'Nahlášeno' },
      { key: 'resolvedAt', header: 'Vyřešeno' },
    ]);
    return csvResponse(`damages-${todayStamp()}.csv`, csv);
  });

function todayStamp(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}
