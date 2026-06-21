import { ns } from './util.js';

export const newLoan = ns({
  cs: {
    back: '← zpět na výpůjčky',
    title: 'Nová výpůjčka',
    titleSimilar: 'Nová podobná výpůjčka',
    prefilledNote:
      'Předvyplněno podle dřívější výpůjčky. Zkontroluj položky – předvybrané assety se zobrazí jen pokud jsou znovu skladem.',
    contactLabel: 'Vybrat existující kontakt (volitelné)',
    contactNone: '— bez kontaktu, ručně níže —',
    borrowerNameLabel: 'Jméno vypůjčujícího',
    borrowerNamePlaceholder: 'Jan Novák',
    borrowerNameRequired: 'Jméno je povinné',
    contactFieldLabel: 'Kontakt (e-mail / telefon)',
    contactFieldPlaceholder: 'jan@example.com',
    purposeLabel: 'Účel (volitelné)',
    loanedAtLabel: 'Začátek výpůjčky (volitelné)',
    loanedAtHelp:
      'Necháš-li prázdné, výpůjčka začne hned. Budoucí datum ji naplánuje – assety se rezervují a vypůjčí se až v termínu (nebo ručně).',
    expectedReturnLabel: 'Předpokládaný návrat',
    itemsTitle: 'Položky výpůjčky',
    itemsHelp: (selected: number) =>
      `Vybrat lze assety volné ve zvoleném termínu – včetně právě půjčených, které se do začátku stihnou vrátit. Nedostupné jsou zašedlé i s důvodem. Vybráno: ${selected}`,
    itemsSearchPlaceholder: 'Hledat kód / název…',
    noAssets: 'Žádné assety neodpovídají hledání.',
    nowLent: 'teď půjčeno',
    saving: 'Ukládám…',
    submit: 'Vytvořit výpůjčku',
    cancel: 'Zrušit',
  },
  en: {
    back: '← back to loans',
    title: 'New loan',
    titleSimilar: 'New similar loan',
    prefilledNote:
      'Prefilled from an earlier loan. Check the items – preselected assets only show if they are back in stock.',
    contactLabel: 'Select an existing contact (optional)',
    contactNone: '— no contact, enter manually below —',
    borrowerNameLabel: 'Borrower name',
    borrowerNamePlaceholder: 'Jan Novák',
    borrowerNameRequired: 'Name is required',
    contactFieldLabel: 'Contact (email / phone)',
    contactFieldPlaceholder: 'jan@example.com',
    purposeLabel: 'Purpose (optional)',
    loanedAtLabel: 'Loan start (optional)',
    loanedAtHelp:
      'If you leave it empty, the loan starts now. A future date schedules it – assets are reserved and lent out only on the date (or manually).',
    expectedReturnLabel: 'Expected return',
    itemsTitle: 'Loan items',
    itemsHelp: (selected: number) =>
      `You can pick assets free in the chosen window – including currently lent ones that make it back before the start. Unavailable ones are dimmed with a reason. Selected: ${selected}`,
    itemsSearchPlaceholder: 'Search code / name…',
    noAssets: 'No assets match the search.',
    nowLent: 'lent now',
    saving: 'Saving…',
    submit: 'Create loan',
    cancel: 'Cancel',
  },
});
