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
        'Povinný: name. Volitelné: code, type (codePrefix existujícího typu), notes. Další sloupce = vlastní pole.',
      'asset-types': 'Povinné: name, code_prefix.',
      locations:
        'Povinný: name. Volitelné: parent_name (musí odpovídat jménu existující lokace).',
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
        'Required: name. Optional: code, type (codePrefix of an existing type), notes. Extra columns = custom fields.',
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
  },
});
