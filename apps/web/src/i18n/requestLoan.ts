import { ns } from './util.js';

export const requestLoan = ns({
  cs: {
    back: '← zpět',
    title: 'Požádat o výpůjčku',
    intro:
      'Vyber assety a termín. Žádost projde ke schválení operátorovi — po schválení se z ní stane rezervace.',
    purposeLabel: 'Účel (volitelné)',
    loanedAtLabel: 'Od (volitelné)',
    loanedAtHelp: 'Necháš-li prázdné, žádáš o co nejdřívější termín (po schválení).',
    expectedReturnLabel: 'Do (volitelné)',
    itemsTitle: 'Assety',
    itemsHelp: (selected: number) =>
      `Vybrat lze assety volné ve zvoleném termínu. Vybráno: ${selected}`,
    itemsSearchPlaceholder: 'Hledat kód / název…',
    noAssets: 'Žádné assety neodpovídají hledání.',
    nowLent: 'teď půjčeno',
    submit: 'Odeslat žádost',
    submitting: 'Odesílám…',
    cancel: 'Zrušit',
    requested: 'Žádost odeslána ke schválení',
  },
  en: {
    back: '← back',
    title: 'Request a loan',
    intro:
      'Pick assets and a period. Your request goes to an operator for approval — once approved it becomes a reservation.',
    purposeLabel: 'Purpose (optional)',
    loanedAtLabel: 'From (optional)',
    loanedAtHelp: 'Leave empty to request the earliest possible date (after approval).',
    expectedReturnLabel: 'To (optional)',
    itemsTitle: 'Assets',
    itemsHelp: (selected: number) =>
      `You can select assets free in the chosen period. Selected: ${selected}`,
    itemsSearchPlaceholder: 'Search code / name…',
    noAssets: 'No assets match the search.',
    nowLent: 'lent now',
    submit: 'Send request',
    submitting: 'Sending…',
    cancel: 'Cancel',
    requested: 'Request sent for approval',
  },
});
