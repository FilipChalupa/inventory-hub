import { ns } from './util.js';

export const labels = ns({
  cs: {
    title: 'Tisk štítků',
    codes: 'Kódy',
    codesHint: 'Vlož kódy jeden na řádek (nebo oddělené čárkou), nebo vyber z assetů vpravo.',
    codesPlaceholder: 'LAP-00001\nMON-00001',
    loadLabels: (n: number) => `Načíst ${n || ''} štítků`,
    print: 'Tisk',
    selectFromAssets: 'Vybrat z assetů',
    filterPlaceholder: 'Filtr…',
    labelSettings: 'Nastavení štítku',
    compactOption: 'Malý kód (jen kód, bez odkazu)',
    showNameOption: 'Tisknout název',
    qrHint:
      'Malý kód kóduje jen kód assetu (menší QR, čte ho čtečka v aplikaci). Velký kóduje plnou adresu, takže ho otevře i foťák v mobilu.',
    noteLabel: 'Poznámka pod kódem (volitelná)',
    notePlaceholder: 'např. Když najdete, ozvěte se: spravce@firma.cz',
    saveAsDefault: 'Uložit jako výchozí pro organizaci',
    savedForOrg: 'Uloženo pro celou organizaci.',
    nonAdminHint:
      'Výchozí nastavení pro organizaci může změnit jen admin; tady si ho můžeš upravit pro tento tisk.',
  },
  en: {
    title: 'Print labels',
    codes: 'Codes',
    codesHint:
      'Paste codes one per line (or comma-separated), or pick from the assets on the right.',
    codesPlaceholder: 'LAP-00001\nMON-00001',
    loadLabels: (n: number) => `Load ${n || ''} labels`,
    print: 'Print',
    selectFromAssets: 'Pick from assets',
    filterPlaceholder: 'Filter…',
    labelSettings: 'Label settings',
    compactOption: 'Compact code (code only, no link)',
    showNameOption: 'Print name',
    qrHint:
      'A compact code encodes only the asset code (smaller QR, read by the scanner in the app). A full code encodes the full address, so a phone camera can open it too.',
    noteLabel: 'Note under the code (optional)',
    notePlaceholder: 'e.g. If found, contact us: admin@company.com',
    saveAsDefault: 'Save as organization default',
    savedForOrg: 'Saved for the whole organization.',
    nonAdminHint:
      'Only an admin can change the organization default; here you can adjust it for this print.',
  },
});
