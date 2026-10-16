import { ns } from './util.js';

export const importAssets = ns({
  cs: {
    title: 'Import z CSV',
    entity: 'Entita',
    kindLabels: {
      assets: 'Assety',
      'asset-types': 'Typy assetů',
      locations: 'Lokace',
    },
    kindHints: {
      assets:
        'Povinný: name. Volitelné: code, type (codePrefix existujícího typu), notes, identifikátory serial / ean / sku nebo id:<druh> (např. id:imei; víc hodnot odděl „;"). Další sloupce = vlastní pole.',
      'asset-types': 'Povinné: name, code_prefix.',
      locations: 'Povinný: name. Volitelné: parent_name (musí odpovídat jménu existující lokace).',
    },
    kindLimits: {
      assets: '1 MB, max 1000 řádků',
      'asset-types': '100 KB, max 200 řádků',
      locations: '100 KB, max 500 řádků',
    },
    limitPrefix: 'Limit:',
    working: 'Pracuji…',
    dryRun: 'Náhled (dry-run)',
    import: 'Importovat',
    imported: (n: number) => `Importováno ${n} záznamů.`,
    goToList: 'Přejít na seznam',
    previewTitle: (rows: number) => `Náhled (${rows} řádků`,
    previewWithErrors: (errors: number) => `, ${errors} s chybami`,
    previewClose: ')',
    colCode: 'code',
    colIssues: 'problémy',
    emptyValue: '—',
    attachToExisting: 'Doplnit identifikátory k existujícím assetům',
    attachToExistingHint:
      'Řádky s kódem, který už existuje, asset nezakládají — jen mu přidají sériová čísla / EAN z CSV. Stačí sloupce code + serial (případně ean, sku, id:<druh>).',
    imported2: (created: number, updated: number) =>
      `Založeno ${created} assetů, doplněny identifikátory u ${updated}.`,
    colAction: 'akce',
    actionCreate: 'nový',
    actionUpdate: 'doplnit',
  },
  en: {
    title: 'Import from CSV',
    entity: 'Entity',
    kindLabels: {
      assets: 'Assets',
      'asset-types': 'Asset types',
      locations: 'Locations',
    },
    kindHints: {
      assets:
        'Required: name. Optional: code, type (codePrefix of an existing type), notes, identifiers serial / ean / sku or id:<kind> (e.g. id:imei; separate several values with ";"). Extra columns = custom fields.',
      'asset-types': 'Required: name, code_prefix.',
      locations:
        'Required: name. Optional: parent_name (must match the name of an existing location).',
    },
    kindLimits: {
      assets: '1 MB, max 1000 rows',
      'asset-types': '100 KB, max 200 rows',
      locations: '100 KB, max 500 rows',
    },
    limitPrefix: 'Limit:',
    working: 'Working…',
    dryRun: 'Preview (dry run)',
    import: 'Import',
    imported: (n: number) => `Imported ${n} records.`,
    goToList: 'Go to list',
    previewTitle: (rows: number) => `Preview (${rows} rows`,
    previewWithErrors: (errors: number) => `, ${errors} with errors`,
    previewClose: ')',
    colCode: 'code',
    colIssues: 'issues',
    emptyValue: '—',
    attachToExisting: 'Add identifiers to existing assets',
    attachToExistingHint:
      "Rows whose code already exists don't create an asset — they only add the serial numbers / EANs from the CSV. Columns code + serial (or ean, sku, id:<kind>) are enough.",
    imported2: (created: number, updated: number) =>
      `Created ${created} assets, added identifiers to ${updated}.`,
    colAction: 'action',
    actionCreate: 'new',
    actionUpdate: 'add ids',
  },
});
