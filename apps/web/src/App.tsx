import {
  lazy,
  Suspense,
  type ComponentType,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import clsx from 'clsx';
import { OfflineBanner } from './components/OfflineBanner.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { SkeletonList } from './components/ui.js';
import { useT, useLocale, type Messages } from './i18n/index.js';
import { LOCALES, LOCALE_LABELS } from './i18n/util.js';
import { AuthProvider, useAuth } from './auth/AuthContext.js';

// Route components are code-split so the initial bundle stays small — each
// page's chunk loads on first navigation. `page` adapts our named exports
// (we don't use default exports) to React.lazy's default-export contract.
function page<T extends Record<string, ComponentType<object>>>(
  loader: () => Promise<T>,
  name: keyof T,
) {
  return lazy(() => loader().then((m) => ({ default: m[name] })));
}

const DashboardPage = page(() => import('./pages/DashboardPage.js'), 'DashboardPage');
const AssetsPage = page(() => import('./pages/AssetsPage.js'), 'AssetsPage');
const AssetDetailPage = page(() => import('./pages/AssetDetailPage.js'), 'AssetDetailPage');
const NewAssetPage = page(() => import('./pages/NewAssetPage.js'), 'NewAssetPage');
const ImportAssetsPage = page(() => import('./pages/ImportAssetsPage.js'), 'ImportAssetsPage');
const ScanPage = page(() => import('./pages/ScanPage.js'), 'ScanPage');
const AssetTypesPage = page(() => import('./pages/AssetTypesPage.js'), 'AssetTypesPage');
const LocationsPage = page(() => import('./pages/LocationsPage.js'), 'LocationsPage');
const LoansPage = page(() => import('./pages/LoansPage.js'), 'LoansPage');
const LoanDetailPage = page(() => import('./pages/LoanDetailPage.js'), 'LoanDetailPage');
const NewLoanPage = page(() => import('./pages/NewLoanPage.js'), 'NewLoanPage');
const CalendarPage = page(() => import('./pages/CalendarPage.js'), 'CalendarPage');
const TodayPage = page(() => import('./pages/TodayPage.js'), 'TodayPage');
const LabelsPage = page(() => import('./pages/LabelsPage.js'), 'LabelsPage');
const InventoryPage = page(() => import('./pages/InventoryPage.js'), 'InventoryPage');
const InventorySessionPage = page(
  () => import('./pages/InventorySessionPage.js'),
  'InventorySessionPage',
);
const SettingsPage = page(() => import('./pages/SettingsPage.js'), 'SettingsPage');
const LoginPage = page(() => import('./pages/LoginPage.js'), 'LoginPage');
const AcceptInvitePage = page(() => import('./pages/AcceptInvitePage.js'), 'AcceptInvitePage');
const UsersPage = page(() => import('./pages/UsersPage.js'), 'UsersPage');
const ContactsPage = page(() => import('./pages/ContactsPage.js'), 'ContactsPage');
const AuditLogPage = page(() => import('./pages/AuditLogPage.js'), 'AuditLogPage');

// Nav items carry an i18n `key`; the visible label is resolved per render from
// the active locale (t.nav[key]).
type NavKey = keyof Messages['nav'];
type NavItem = { to: string; key: NavKey; end?: boolean };

// Primary workflow — always visible in the bar.
const mainNav: NavItem[] = [
  { to: '/dashboard', key: 'dashboard' },
  { to: '/assets', key: 'assets' },
  { to: '/scan', key: 'scan' },
  { to: '/loans', key: 'loans' },
  { to: '/calendar', key: 'calendar' },
  { to: '/inventory', key: 'inventory' },
];

// Reference data — grouped under the "Číselníky" dropdown.
const catalogNav: NavItem[] = [
  { to: '/asset-types', key: 'types' },
  { to: '/locations', key: 'locations' },
  { to: '/labels', key: 'labels' },
  { to: '/contacts', key: 'contacts' },
];

// Admin-only — grouped under the user menu (top right).
const adminNav: NavItem[] = [
  { to: '/audit', key: 'audit' },
  { to: '/users', key: 'users' },
  { to: '/settings', key: 'settings' },
];

export function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}

function Shell() {
  const { state, isLoading } = useAuth();
  const location = useLocation();
  const t = useT();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close the mobile menu whenever the route changes (a link was tapped).
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-500">
        {t.common.loading}
      </div>
    );
  }

  const isPublicRoute = location.pathname === '/login' || location.pathname === '/accept-invite';

  if (!state?.authenticated) {
    if (isPublicRoute) {
      return (
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/accept-invite" element={<AcceptInvitePage />} />
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        </Suspense>
      );
    }
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="min-h-screen flex flex-col">
      <OfflineBanner />
      <header className="border-b border-slate-200 bg-white sticky top-0 z-10 print:hidden dark:bg-slate-800 dark:border-slate-700">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-4 sm:gap-6">
          <button
            type="button"
            className="sm:hidden -ml-1 rounded p-1.5 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
            aria-label="Menu"
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((v) => !v)}
          >
            <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="w-6 h-6">
              {mobileOpen ? (
                <path
                  fillRule="evenodd"
                  d="M5.22 5.22a.75.75 0 0 1 1.06 0L10 8.94l3.72-3.72a.75.75 0 1 1 1.06 1.06L11.06 10l3.72 3.72a.75.75 0 1 1-1.06 1.06L10 11.06l-3.72 3.72a.75.75 0 0 1-1.06-1.06L8.94 10 5.22 6.28a.75.75 0 0 1 0-1.06Z"
                  clipRule="evenodd"
                />
              ) : (
                <path
                  fillRule="evenodd"
                  d="M2.5 5.75A.75.75 0 0 1 3.25 5h13.5a.75.75 0 0 1 0 1.5H3.25a.75.75 0 0 1-.75-.75Zm0 4.25A.75.75 0 0 1 3.25 9.25h13.5a.75.75 0 0 1 0 1.5H3.25a.75.75 0 0 1-.75-.75Zm.75 3.5a.75.75 0 0 0 0 1.5h13.5a.75.75 0 0 0 0-1.5H3.25Z"
                  clipRule="evenodd"
                />
              )}
            </svg>
          </button>
          <NavLink to="/" className="font-semibold text-lg whitespace-nowrap">
            Inventory Hub
          </NavLink>
          <nav className="hidden sm:flex items-center gap-1 text-sm flex-1">
            {mainNav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => clsx(navItemClass, navItemState(isActive))}
              >
                {t.nav[item.key]}
              </NavLink>
            ))}
            <Dropdown
              trigger={t.nav.catalog}
              active={catalogNav.some((item) => location.pathname === item.to)}
            >
              {catalogNav.map((item) => (
                <DropdownLink key={item.to} to={item.to}>
                  {t.nav[item.key]}
                </DropdownLink>
              ))}
            </Dropdown>
          </nav>
          <div className="ml-auto sm:ml-0">
            <UserMenu />
          </div>
        </div>
        {mobileOpen && <MobileMenu />}
      </header>
      <main className="flex-1">
        <div className="max-w-6xl mx-auto px-4 py-6">
          {/* key on the path remounts the boundary on navigation, so a crashed
              page doesn't keep showing its fallback after you move away. */}
          <ErrorBoundary key={location.pathname}>
            <Suspense fallback={<RouteFallback />}>
              <Routes>
                <Route path="/" element={<TodayPage />} />
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/assets" element={<AssetsPage />} />
                <Route path="/assets/new" element={<NewAssetPage />} />
                <Route path="/assets/import" element={<ImportAssetsPage />} />
                <Route path="/scan" element={<ScanPage />} />
                <Route path="/a/:code" element={<AssetDetailPage />} />
                <Route path="/asset-types" element={<AssetTypesPage />} />
                <Route path="/locations" element={<LocationsPage />} />
                <Route path="/loans" element={<LoansPage />} />
                <Route path="/loans/new" element={<NewLoanPage />} />
                <Route path="/loans/:id" element={<LoanDetailPage />} />
                <Route path="/calendar" element={<CalendarPage />} />
                <Route path="/inventory" element={<InventoryPage />} />
                <Route path="/inventory/:id" element={<InventorySessionPage />} />
                <Route path="/labels" element={<LabelsPage />} />
                <Route path="/audit" element={<AuditLogPage />} />
                <Route path="/users" element={<UsersPage />} />
                <Route path="/contacts" element={<ContactsPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/login" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </ErrorBoundary>
        </div>
      </main>
    </div>
  );
}

/** Placeholder shown while a route's code-split chunk loads. */
function RouteFallback() {
  return (
    <div className="py-6">
      <SkeletonList />
    </div>
  );
}

/** Vertical nav shown under the header on small screens (toggled by ☰). */
function MobileMenu() {
  const t = useT();
  const mobileLink = ({ isActive }: { isActive: boolean }) =>
    clsx(
      'block rounded px-3 py-2 text-sm',
      isActive
        ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
        : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700',
    );
  return (
    <nav className="sm:hidden border-t border-slate-200 px-2 py-2 dark:border-slate-700">
      {mainNav.map((item) => (
        <NavLink key={item.to} to={item.to} end={item.end} className={mobileLink}>
          {t.nav[item.key]}
        </NavLink>
      ))}
      <div className="mt-2 mb-1 px-3 text-xs font-medium uppercase tracking-wide text-slate-400">
        {t.nav.catalog}
      </div>
      {catalogNav.map((item) => (
        <NavLink key={item.to} to={item.to} className={mobileLink}>
          {t.nav[item.key]}
        </NavLink>
      ))}
      <div className="mt-2 border-t border-slate-200 pt-2 dark:border-slate-700">
        <LanguageSwitcher />
      </div>
    </nav>
  );
}

/** Language selector used in the user menu (desktop) and mobile menu. */
function LanguageSwitcher({ className }: { className?: string }) {
  const [locale, setLocale] = useLocale();
  return (
    <select
      aria-label="Language"
      value={locale}
      onChange={(e) => setLocale(e.target.value as (typeof LOCALES)[number])}
      className={clsx(
        'rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200',
        className,
      )}
    >
      {LOCALES.map((l) => (
        <option key={l} value={l}>
          {LOCALE_LABELS[l]}
        </option>
      ))}
    </select>
  );
}

function UserMenu() {
  const { state, logout } = useAuth();
  const t = useT();
  if (!state?.authenticated) return null;
  const u = state.user;
  const adminItems = u.role === 'admin' ? adminNav : [];
  return (
    <Dropdown
      align="right"
      triggerClassName="flex items-center gap-3 rounded px-1 py-1 transition-colors hover:bg-slate-100 dark:hover:bg-slate-700"
      trigger={
        <>
          <span className="text-right hidden sm:block">
            <span className="block text-sm font-medium">{u.name}</span>
            <span className="block text-xs text-slate-500 dark:text-slate-400">
              {t.common.roles[u.role] ?? u.role}
            </span>
          </span>
          {u.imageUrl ? (
            <img src={u.imageUrl} alt="" className="w-8 h-8 rounded-full" />
          ) : (
            <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-xs font-medium text-slate-700 dark:text-slate-200">
              {u.name.slice(0, 1).toUpperCase()}
            </div>
          )}
        </>
      }
    >
      {adminItems.map((item) => (
        <DropdownLink key={item.to} to={item.to}>
          {t.nav[item.key]}
        </DropdownLink>
      ))}
      {adminItems.length > 0 && (
        <div className="my-1 border-t border-slate-200 dark:border-slate-700" />
      )}
      <div className="hidden px-3 py-2 sm:block" onClick={(e) => e.stopPropagation()}>
        <LanguageSwitcher className="w-full" />
      </div>
      <div className="my-1 hidden border-t border-slate-200 sm:block dark:border-slate-700" />
      <button
        type="button"
        onClick={() => logout()}
        className="block w-full px-3 py-2 text-left text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
      >
        {t.nav.logout}
      </button>
    </Dropdown>
  );
}

const navItemClass = 'px-3 py-1.5 rounded transition-colors whitespace-nowrap';

function navItemState(isActive: boolean) {
  return isActive
    ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700';
}

/**
 * Headless dropdown: a trigger button plus a panel that closes on outside
 * click, Escape, or selecting any item inside it.
 */
function Dropdown({
  trigger,
  children,
  active,
  align = 'left',
  triggerClassName,
}: {
  trigger: ReactNode;
  children: ReactNode;
  active?: boolean;
  align?: 'left' | 'right';
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={
          triggerClassName ??
          clsx(navItemClass, 'flex items-center gap-1', navItemState(Boolean(active) || open))
        }
      >
        {trigger}
        {triggerClassName ? null : (
          <svg
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
            className={clsx('w-4 h-4 transition-transform', open && 'rotate-180')}
          >
            <path
              fillRule="evenodd"
              d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.06l3.71-3.83a.75.75 0 1 1 1.08 1.04l-4.25 4.39a.75.75 0 0 1-1.08 0L5.21 8.27a.75.75 0 0 1 .02-1.06Z"
              clipRule="evenodd"
            />
          </svg>
        )}
      </button>
      {open && (
        <div
          role="menu"
          onClick={() => setOpen(false)}
          className={clsx(
            'absolute mt-1 min-w-44 rounded-md border border-slate-200 bg-white py-1 shadow-lg z-20 dark:bg-slate-800 dark:border-slate-700',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}

function DropdownLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <NavLink
      to={to}
      role="menuitem"
      className={({ isActive }) =>
        clsx(
          'block px-3 py-2 text-sm whitespace-nowrap',
          isActive
            ? 'bg-slate-100 font-medium text-slate-900 dark:bg-slate-700 dark:text-white'
            : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700',
        )
      }
    >
      {children}
    </NavLink>
  );
}
