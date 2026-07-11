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
  },
  en: {
    searchButton: 'Search…',
    placeholder: 'Search or jump to…',
    navSection: 'Go to',
    assetsSection: 'Assets',
    loading: 'Searching…',
    empty: 'Nothing found',
    dialogLabel: 'Command palette',
  },
});
