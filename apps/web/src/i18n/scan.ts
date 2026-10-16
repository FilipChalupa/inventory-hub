import { ns } from './util.js';

export const scan = ns({
  cs: {
    backToList: '← zpět na seznam',
    title: 'Skenovat',
    cameraError: 'Kameru nelze otevřít — povol přístup nebo zadej kód ručně.',
    initializing: 'Inicializuji kameru…',
    invalidCode: 'Neplatný formát kódu',
    manualEntry: 'Ruční zadání',
    open: 'Otevřít',
    manualPlaceholder: 'LAP-00001 nebo sériové číslo, EAN…',
    resolving: 'Hledám…',
    notFound: (v: string) => `Nic s identifikátorem „${v}" nenalezeno.`,
    pickOne: (v: string) => `„${v}" odpovídá více assetům, vyber:`,
    matchedCode: 'kód',
    matchedCustom: (key: string) => `pole ${key}`,
  },
  en: {
    backToList: '← back to list',
    title: 'Scan',
    cameraError: 'Cannot open the camera — allow access or enter the code manually.',
    initializing: 'Initializing camera…',
    invalidCode: 'Invalid code format',
    manualEntry: 'Manual entry',
    open: 'Open',
    manualPlaceholder: 'LAP-00001 or a serial number, EAN…',
    resolving: 'Looking up…',
    notFound: (v: string) => `Nothing found for "${v}".`,
    pickOne: (v: string) => `"${v}" matches several assets, pick one:`,
    matchedCode: 'code',
    matchedCustom: (key: string) => `field ${key}`,
  },
});
