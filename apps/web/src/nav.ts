import type { Messages } from './i18n/index.js';

export type NavKey = keyof Messages['nav'];
export type NavItem = { to: string; key: NavKey; end?: boolean };

// Primary workflow — always visible in the bar.
export const mainNav: NavItem[] = [
  { to: '/dashboard', key: 'dashboard' },
  { to: '/assets', key: 'assets' },
  { to: '/scan', key: 'scan' },
  { to: '/loans', key: 'loans' },
  { to: '/calendar', key: 'calendar' },
  { to: '/inventory', key: 'inventory' },
];

// Reference data — grouped under the "Číselníky" dropdown.
export const catalogNav: NavItem[] = [
  { to: '/asset-types', key: 'types' },
  { to: '/locations', key: 'locations' },
  { to: '/labels', key: 'labels' },
  { to: '/contacts', key: 'contacts' },
];

// Admin-only — grouped under the user menu (top right).
export const adminNav: NavItem[] = [
  { to: '/audit', key: 'audit' },
  { to: '/users', key: 'users' },
  { to: '/settings', key: 'settings' },
];
