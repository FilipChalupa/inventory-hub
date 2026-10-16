import { ns } from './util.js';

/** Strings for shared UI components under src/components/*. */
export const components = ns({
  cs: {
    // ViaAgentBadge
    viaAgent: 'přes AI',
    viaAgentTitle: (name: string) => `Provedl AI asistent „${name}" jménem uživatele`,
    // Toast
    toastClose: 'Zavřít',
    // ErrorBoundary
    errorTitle: 'Něco se pokazilo',
    errorBody: 'Tuhle stránku se nepodařilo zobrazit. Zkus to prosím znovu, nebo se vrať na úvod.',
    errorRetry: 'Zkusit znovu',
    errorHome: 'Domů',
    // CustomFieldsValuesForm
    selectPlaceholder: '— vybrat —',
    // LocationSelect
    locationNone: '— bez lokace —',
    // CustomFieldsSchemaEditor
    fieldTypeText: 'Text',
    fieldTypeNumber: 'Číslo',
    fieldTypeDate: 'Datum',
    fieldTypeBoolean: 'Ano/Ne',
    fieldTypeSelect: 'Výběr ze seznamu',
    schemaEmpty: 'Žádné vlastní pole.',
    schemaKey: 'Klíč',
    schemaLabel: 'Popisek',
    schemaType: 'Typ',
    schemaRequired: 'Povinné',
    schemaOptions: 'Možnosti (čárkou)',
    schemaAddTitle: 'Přidat pole',
    schemaKeyHint: 'Klíč (a-z, _)',
    schemaKeyPlaceholder: 'serial_number',
    schemaLabelPlaceholder: 'Sériové číslo',
    schemaAdd: 'Přidat',
    schemaOptionsPlaceholder: 'nový, použitý, rozbalený',
    // OfflineBanner
    offlineMessage:
      'Offline režim — uložené stránky a poslední data zůstanou dostupné, ale změny (vytvořit / upravit / vrátit) teď nejde uložit. Výjimkou jsou skeny v inventuře: ty se uloží a odešlou po obnovení připojení.',
  },
  en: {
    viaAgent: 'via AI',
    viaAgentTitle: (name: string) => `Done by AI assistant "${name}" on the user's behalf`,
    // Toast
    toastClose: 'Close',
    // ErrorBoundary
    errorTitle: 'Something went wrong',
    errorBody: 'This page could not be displayed. Please try again, or return home.',
    errorRetry: 'Try again',
    errorHome: 'Home',
    // CustomFieldsValuesForm
    selectPlaceholder: '— select —',
    // LocationSelect
    locationNone: '— no location —',
    // CustomFieldsSchemaEditor
    fieldTypeText: 'Text',
    fieldTypeNumber: 'Number',
    fieldTypeDate: 'Date',
    fieldTypeBoolean: 'Yes/No',
    fieldTypeSelect: 'Select from list',
    schemaEmpty: 'No custom fields.',
    schemaKey: 'Key',
    schemaLabel: 'Label',
    schemaType: 'Type',
    schemaRequired: 'Required',
    schemaOptions: 'Options (comma-separated)',
    schemaAddTitle: 'Add field',
    schemaKeyHint: 'Key (a-z, _)',
    schemaKeyPlaceholder: 'serial_number',
    schemaLabelPlaceholder: 'Serial number',
    schemaAdd: 'Add',
    schemaOptionsPlaceholder: 'new, used, opened',
    // OfflineBanner
    offlineMessage:
      "Offline mode — saved pages and the latest data stay available, but changes (create / edit / return) can't be saved right now. Inventory scans are the exception: they are kept and sent once the connection is back.",
  },
});
