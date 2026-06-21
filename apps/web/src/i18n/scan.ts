import { ns } from './util.js';

export const scan = ns({
  cs: {
    backToList: '← zpět na seznam',
    title: 'Skenovat QR',
    cameraError: 'Kameru nelze otevřít — povol přístup nebo zadej kód ručně.',
    initializing: 'Inicializuji kameru…',
    invalidCode: 'Neplatný formát kódu',
    manualEntry: 'Ruční zadání',
    open: 'Otevřít',
  },
  en: {
    backToList: '← back to list',
    title: 'Scan QR',
    cameraError: 'Cannot open the camera — allow access or enter the code manually.',
    initializing: 'Initializing camera…',
    invalidCode: 'Invalid code format',
    manualEntry: 'Manual entry',
    open: 'Open',
  },
});
