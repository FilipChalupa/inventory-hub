import { ns } from './util.js';

export const commandPalette = ns({
  cs: {
    // Trigger button in the top bar.
    searchButton: 'Hledat…',
    // Text input inside the palette.
    placeholder: 'Hledat nebo přejít…',
    // Section headers in the results list.
    navSection: 'Přejít na',
    assetsSection: 'Assety',
    // States for the asset search section.
    loading: 'Hledám…',
    empty: 'Nic nenalezeno',
    // aria-label for the dialog.
    dialogLabel: 'Příkazová paleta',
    // Why an exact identifier hit matched (shown next to the asset).
    matchedCode: 'kód',
    matchedField: (key: string) => `pole ${key}`,
  },
  en: {
    searchButton: 'Search…',
    placeholder: 'Search or jump to…',
    navSection: 'Go to',
    assetsSection: 'Assets',
    loading: 'Searching…',
    empty: 'Nothing found',
    dialogLabel: 'Command palette',
    matchedCode: 'code',
    matchedField: (key: string) => `field ${key}`,
  },
});
