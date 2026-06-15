import { type ReactNode, useEffect, useRef, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import clsx from 'clsx';
import { OfflineBanner } from './components/OfflineBanner.js';
import { t } from './i18n/messages.js';
import { AssetsPage } from './pages/AssetsPage.js';
import { AssetDetailPage } from './pages/AssetDetailPage.js';
import { NewAssetPage } from './pages/NewAssetPage.js';
import { ImportAssetsPage } from './pages/ImportAssetsPage.js';
import { ScanPage } from './pages/ScanPage.js';
import { AssetTypesPage } from './pages/AssetTypesPage.js';
import { LocationsPage } from './pages/LocationsPage.js';
import { LoansPage } from './pages/LoansPage.js';
import { LoanDetailPage } from './pages/LoanDetailPage.js';
import { NewLoanPage } from './pages/NewLoanPage.js';
import { LabelsPage } from './pages/LabelsPage.js';
import { InventoryPage } from './pages/InventoryPage.js';
import { InventorySessionPage } from './pages/InventorySessionPage.js';
import { SettingsPage } from './pages/SettingsPage.js';
import { LoginPage } from './pages/LoginPage.js';
import { AcceptInvitePage } from './pages/AcceptInvitePage.js';
import { UsersPage } from './pages/UsersPage.js';
import { ContactsPage } from './pages/ContactsPage.js';
import { AuditLogPage } from './pages/AuditLogPage.js';
import { AuthProvider, useAuth } from './auth/AuthContext.js';

// Primary workflow — always visible in the bar.
const mainNav: { to: string; label: string; end?: boolean }[] = [
  { to: '/', label: t.nav.assets, end: true },
  { to: '/scan', label: t.nav.scan },
  { to: '/loans', label: t.nav.loans },
  { to: '/inventory', label: t.nav.inventory },
];

// Reference data — grouped under the "Číselníky" dropdown.
const catalogNav = [
  { to: '/asset-types', label: t.nav.types },
  { to: '/locations', label: t.nav.locations },
  { to: '/labels', label: t.nav.labels },
  { to: '/contacts', label: t.nav.contacts },
];

// Admin-only — grouped under the user menu (top right).
const adminNav = [
  { to: '/audit', label: t.nav.audit },
  { to: '/users', label: t.nav.users },
  { to: '/settings', label: t.nav.settings },
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

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-500">
        Načítám…
      </div>
    );
  }

  const isPublicRoute =
    location.pathname === '/login' || location.pathname === '/accept-invite';

  if (!state?.authenticated) {
    if (isPublicRoute) {
      return (
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/accept-invite" element={<AcceptInvitePage />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      );
    }
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="min-h-screen flex flex-col">
      <OfflineBanner />
      <header className="border-b border-slate-200 bg-white sticky top-0 z-10 print:hidden dark:bg-slate-800 dark:border-slate-700">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-6">
          <NavLink to="/" className="font-semibold text-lg whitespace-nowrap">
            Inventory Hub
          </NavLink>
          <nav className="flex items-center gap-1 text-sm flex-1">
            {mainNav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => clsx(navItemClass, navItemState(isActive))}
              >
                {item.label}
              </NavLink>
            ))}
            <Dropdown
              trigger={t.nav.catalog}
              active={catalogNav.some((item) => location.pathname === item.to)}
            >
              {catalogNav.map((item) => (
                <DropdownLink key={item.to} to={item.to}>
                  {item.label}
                </DropdownLink>
              ))}
            </Dropdown>
          </nav>
          <UserMenu />
        </div>
      </header>
      <main className="flex-1">
        <div className="max-w-6xl mx-auto px-4 py-6">
          <Routes>
            <Route path="/" element={<AssetsPage />} />
            <Route path="/assets/new" element={<NewAssetPage />} />
            <Route path="/assets/import" element={<ImportAssetsPage />} />
            <Route path="/scan" element={<ScanPage />} />
            <Route path="/a/:code" element={<AssetDetailPage />} />
            <Route path="/asset-types" element={<AssetTypesPage />} />
            <Route path="/locations" element={<LocationsPage />} />
            <Route path="/loans" element={<LoansPage />} />
            <Route path="/loans/new" element={<NewLoanPage />} />
            <Route path="/loans/:id" element={<LoanDetailPage />} />
            <Route path="/inventory" element={<InventoryPage />} />
            <Route path="/inventory/:id" element={<InventorySessionPage />} />
            <Route path="/labels" element={<LabelsPage />} />
            <Route path="/audit" element={<AuditLogPage />} />
            <Route path="/users" element={<UsersPage />} />
            <Route path="/contacts" element={<ContactsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/login" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}

function UserMenu() {
  const { state, logout } = useAuth();
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
              {u.role}
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
          {item.label}
        </DropdownLink>
      ))}
      {adminItems.length > 0 && (
        <div className="my-1 border-t border-slate-200 dark:border-slate-700" />
      )}
      <button
        type="button"
        onClick={() => logout()}
        className="block w-full px-3 py-2 text-left text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
      >
        Odhlásit
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
          clsx(
            navItemClass,
            'flex items-center gap-1',
            navItemState(Boolean(active) || open),
          )
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

function DropdownLink({
  to,
  children,
}: {
  to: string;
  children: ReactNode;
}) {
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
