import { ns } from './util.js';

export const loanDetail = ns({
  cs: {
    // Header
    createSimilar: 'Založit podobnou',
    cancelReservationTitle: 'Zrušit tuto rezervaci?',
    cancelReservationMessage: 'Akci nelze vrátit.',
    cancelReservationLabel: 'Zrušit rezervaci',
    cancellingReservation: 'Ruším…',
    cancelReservation: 'Zrušit rezervaci',
    reservationCancelled: 'Rezervace zrušena',
    purpose: (value: string) => `Účel: ${value}`,
    plannedStart: 'Plánovaný začátek',
    loanedOut: 'Zapůjčeno',
    returnBy: 'Vrátit do',

    // Items card
    items: 'Položky',

    // ReturnAllButton
    returnAll: (count: number) => `Vrátit vše (${count})`,
    returnDate: 'Datum vrácení',
    returningAll: 'Vracím…',
    returnAllAsOk: (count: number) => `Vrátit vše (${count}) jako v pořádku`,

    // EditLoanForm
    borrowerNameLabel: 'Jméno vypůjčujícího',
    contactLabel: 'Kontakt (e-mail / telefon)',
    purposeLabel: 'Účel',
    loanStartLabel: 'Začátek výpůjčky',
    returnByLabel: 'Vrátit do',

    // StartLoanBar
    plannedNotice: 'Výpůjčka je naplánovaná. Spustí se sama v termínu, nebo ji můžeš zahájit teď.',
    starting: 'Zahajuji…',
    startLoan: 'Zahájit výpůjčku',

    // AddLoanItems
    addItem: '+ Přidat položku',
    availableInTerm: (selectedCount: number) =>
      `Assety volné v termínu výpůjčky. Vybráno: ${selectedCount}`,
    searchPlaceholder: 'Hledat kód / název…',
    noAvailableAssets: 'Žádné dostupné assety.',
    nowOnLoan: 'teď půjčeno',
    adding: 'Přidávám…',
    addSelected: (count: number) => `Přidat (${count})`,

    // LoanItemRowComp
    returnedAt: (date: string) => `vráceno ${date}`,
    damagedSuffix: ' · poškozeno',
    removeItemTitle: (code: string) => `Odebrat ${code} z výpůjčky?`,
    removeItemLabel: 'Odebrat',
    remove: 'Odebrat',
    itemRemoved: 'Položka odebrána',
    return: 'Vrátit',
    returnDateLabel: 'Datum vrácení',
    returnConditionLabel: 'Stav při vrácení',
    conditionOk: 'V pořádku',
    conditionDamaged: 'Poškozeno (→ vytvoří se damage report)',
    noteLabel: 'Poznámka',
    confirmReturn: 'Potvrdit vrácení',

    // History
    history: 'Historie',
    noHistory: 'Zatím žádné záznamy.',
    system: 'systém',
    eventLabels: {
      loan_requested: 'Žádost o výpůjčku',
      loan_approved: 'Žádost schválena',
      loan_rejected: 'Žádost zamítnuta',
      loan_planned: 'Rezervace vytvořena',
      loan_started: 'Zahájeno / vypůjčeno',
      loan_item_returned: 'Položka vrácena',
      loan_item_added: 'Položka přidána',
      loan_item_removed: 'Položka odebrána',
      loan_updated: 'Upraveno',
      loan_cancelled: 'Rezervace zrušena',
      damage_reported: 'Nahlášeno poškození',
    } as Record<string, string>,
    fieldLabels: {
      borrowerName: 'Jméno',
      borrowerContact: 'Kontakt',
      borrowerContactId: 'Kontakt (vazba)',
      purpose: 'Účel',
      loanedAt: 'Začátek',
      expectedReturnAt: 'Návrat',
    } as Record<string, string>,
  },
  en: {
    // Header
    createSimilar: 'Create similar',
    cancelReservationTitle: 'Cancel this reservation?',
    cancelReservationMessage: 'This cannot be undone.',
    cancelReservationLabel: 'Cancel reservation',
    cancellingReservation: 'Cancelling…',
    cancelReservation: 'Cancel reservation',
    reservationCancelled: 'Reservation cancelled',
    purpose: (value: string) => `Purpose: ${value}`,
    plannedStart: 'Planned start',
    loanedOut: 'Loaned out',
    returnBy: 'Return by',

    // Items card
    items: 'Items',

    // ReturnAllButton
    returnAll: (count: number) => `Return all (${count})`,
    returnDate: 'Return date',
    returningAll: 'Returning…',
    returnAllAsOk: (count: number) => `Return all (${count}) in good condition`,

    // EditLoanForm
    borrowerNameLabel: 'Borrower name',
    contactLabel: 'Contact (email / phone)',
    purposeLabel: 'Purpose',
    loanStartLabel: 'Loan start',
    returnByLabel: 'Return by',

    // StartLoanBar
    plannedNotice:
      'The loan is planned. It will start automatically on its date, or you can start it now.',
    starting: 'Starting…',
    startLoan: 'Start loan',

    // AddLoanItems
    addItem: '+ Add item',
    availableInTerm: (selectedCount: number) =>
      `Available assets during the loan period. Selected: ${selectedCount}`,
    searchPlaceholder: 'Search code / name…',
    noAvailableAssets: 'No available assets.',
    nowOnLoan: 'on loan now',
    adding: 'Adding…',
    addSelected: (count: number) => `Add (${count})`,

    // LoanItemRowComp
    returnedAt: (date: string) => `returned ${date}`,
    damagedSuffix: ' · damaged',
    removeItemTitle: (code: string) => `Remove ${code} from the loan?`,
    removeItemLabel: 'Remove',
    remove: 'Remove',
    itemRemoved: 'Item removed',
    return: 'Return',
    returnDateLabel: 'Return date',
    returnConditionLabel: 'Condition on return',
    conditionOk: 'OK',
    conditionDamaged: 'Damaged (→ creates a damage report)',
    noteLabel: 'Note',
    confirmReturn: 'Confirm return',

    // History
    history: 'History',
    noHistory: 'No records yet.',
    system: 'system',
    eventLabels: {
      loan_requested: 'Loan requested',
      loan_approved: 'Request approved',
      loan_rejected: 'Request rejected',
      loan_planned: 'Reservation created',
      loan_started: 'Started / loaned out',
      loan_item_returned: 'Item returned',
      loan_item_added: 'Item added',
      loan_item_removed: 'Item removed',
      loan_updated: 'Updated',
      loan_cancelled: 'Reservation cancelled',
      damage_reported: 'Damage reported',
    } as Record<string, string>,
    fieldLabels: {
      borrowerName: 'Name',
      borrowerContact: 'Contact',
      borrowerContactId: 'Contact (link)',
      purpose: 'Purpose',
      loanedAt: 'Start',
      expectedReturnAt: 'Return',
    } as Record<string, string>,
  },
});
