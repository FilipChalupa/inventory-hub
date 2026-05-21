import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { assets, assetTypes } from '../db/schema.js';
import type { Db } from '../db/client.js';
import { generateAssetCode } from './asset-code.js';
import { createTestDb } from './test-db.js';

describe('generateAssetCode', () => {
  let db: Db;
  let sqlite: Database.Database;

  beforeEach(() => {
    ({ db, sqlite } = createTestDb());
    db.insert(assetTypes).values({ id: 't-lap', name: 'Laptop', codePrefix: 'LAP' }).run();
  });

  afterEach(() => {
    sqlite.close();
  });

  function insertAsset(code: string) {
    db.insert(assets).values({ id: crypto.randomUUID(), code, name: code, typeId: 't-lap' }).run();
  }

  it('returns 00001 for the first asset in an empty category', () => {
    expect(generateAssetCode(db, 'LAP', null)).toBe('LAP-00001');
  });

  it('pads sequence to at least 5 digits', () => {
    insertAsset('LAP-00007');
    expect(generateAssetCode(db, 'LAP', null)).toBe('LAP-00008');
  });

  it('increments past the highest existing sequence, even with gaps', () => {
    insertAsset('LAP-00001');
    insertAsset('LAP-00002');
    insertAsset('LAP-00050');
    expect(generateAssetCode(db, 'LAP', null)).toBe('LAP-00051');
  });

  it('does not collide with concurrent categories', () => {
    db.insert(assetTypes).values({ id: 't-mon', name: 'Monitor', codePrefix: 'MON' }).run();
    insertAsset('LAP-00010');
    insertAsset('MON-00099');
    expect(generateAssetCode(db, 'LAP', null)).toBe('LAP-00011');
    expect(generateAssetCode(db, 'MON', null)).toBe('MON-00100');
  });

  it('respects an org prefix and isolates it from the unprefixed pool', () => {
    insertAsset('LAP-00007'); // unprefixed
    insertAsset('ACME-LAP-00003'); // prefixed
    expect(generateAssetCode(db, 'LAP', 'ACME')).toBe('ACME-LAP-00004');
    expect(generateAssetCode(db, 'LAP', null)).toBe('LAP-00008');
  });

  it('grows beyond 5 digits when the sequence overflows', () => {
    insertAsset('LAP-99999');
    expect(generateAssetCode(db, 'LAP', null)).toBe('LAP-100000');
  });

  it('ignores rows in the same category that are not sequence-formatted', () => {
    insertAsset('LAP-LEGACY-A');
    insertAsset('LAP-00002');
    expect(generateAssetCode(db, 'LAP', null)).toBe('LAP-00003');
  });

  it('treats prefix LAP- and prefix LAPX- as separate pools', () => {
    db.insert(assetTypes).values({ id: 't-lapx', name: 'LaptopX', codePrefix: 'LAPX' }).run();
    insertAsset('LAPX-00050');
    expect(generateAssetCode(db, 'LAP', null)).toBe('LAP-00001');
  });
});
