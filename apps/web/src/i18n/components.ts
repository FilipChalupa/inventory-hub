import { ns } from './util.js';

/** Strings for shared UI components under src/components/*. */
export const components = ns({
  cs: {
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
      'Offline režim — uložené stránky a poslední data zůstanou dostupné, ale změny (vytvořit / upravit / vrátit) se uloží až po obnovení připojení.',
  },
  en: {
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
      'Offline mode — saved pages and the latest data stay available, but changes (create / edit / return) will only be saved once the connection is restored.',
  },
});
