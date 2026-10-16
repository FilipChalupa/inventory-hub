import { ns } from './util.js';

export const login = ns({
  cs: {
    subtitle: 'Přihlas se a pokračuj.',
    sharedDevice: 'Sdílené zařízení',
    sharedDeviceHint:
      'Na tabletu nebo počítači, který používá víc lidí: aplikace si tě nebude pamatovat pro práci offline.',
    continueWithGoogle: 'Pokračovat přes Google',
    noMethodTitle: 'Přihlášení zatím není nastavené',
    noMethodBody:
      'Tento server nemá nakonfigurované přihlášení přes Google a dev login je v produkci vypnutý. Nastav Google OAuth (GOOGLE_CLIENT_ID / SECRET / REDIRECT_URL) podle návodu.',
    setupGuide: 'Návod v SELF_HOSTING →',
    devMode: 'dev mode',
    existingUserEmail: 'E-mail existujícího uživatele',
    signingIn: 'Přihlašuji…',
    devLogin: 'Dev login',
    devLoginHint:
      'Dev login je vypnutý v produkci. Potřebuje, aby uživatel s daným e-mailem v databázi existoval (viz ',
    devLoginHintEnd: ').',
  },
  en: {
    sharedDevice: 'Shared device',
    sharedDeviceHint:
      "On a tablet or computer several people use: the app won't remember you for offline use.",
    subtitle: 'Sign in to continue.',
    continueWithGoogle: 'Continue with Google',
    noMethodTitle: 'Sign-in is not set up yet',
    noMethodBody:
      'This server has no Google sign-in configured and dev login is disabled in production. Set up Google OAuth (GOOGLE_CLIENT_ID / SECRET / REDIRECT_URL) following the guide.',
    setupGuide: 'See SELF_HOSTING →',
    devMode: 'dev mode',
    existingUserEmail: 'Existing user email',
    signingIn: 'Signing in…',
    devLogin: 'Dev login',
    devLoginHint:
      'Dev login is disabled in production. It requires a user with the given email to exist in the database (see ',
    devLoginHintEnd: ').',
  },
});
