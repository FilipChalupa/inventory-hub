import { ns } from './util.js';

export const login = ns({
  cs: {
    subtitle: 'Přihlas se a pokračuj.',
    continueWithGoogle: 'Pokračovat přes Google',
    devMode: 'dev mode',
    existingUserEmail: 'E-mail existujícího uživatele',
    signingIn: 'Přihlašuji…',
    devLogin: 'Dev login',
    devLoginHint: 'Dev login je vypnutý v produkci. Potřebuje, aby uživatel s daným e-mailem v databázi existoval (viz ',
    devLoginHintEnd: ').',
  },
  en: {
    subtitle: 'Sign in to continue.',
    continueWithGoogle: 'Continue with Google',
    devMode: 'dev mode',
    existingUserEmail: 'Existing user e-mail',
    signingIn: 'Signing in…',
    devLogin: 'Dev login',
    devLoginHint: 'Dev login is disabled in production. It requires a user with the given e-mail to exist in the database (see ',
    devLoginHintEnd: ').',
  },
});
