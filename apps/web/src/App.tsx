import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import clsx from 'clsx';
import { AssetsPage } from './pages/AssetsPage.js';
import { AssetDetailPage } from './pages/AssetDetailPage.js';
import { NewAssetPage } from './pages/NewAssetPage.js';
import { AssetTypesPage } from './pages/AssetTypesPage.js';
import { LocationsPage } from './pages/LocationsPage.js';
import { LoansPage } from './pages/LoansPage.js';
import { LoanDetailPage } from './pages/LoanDetailPage.js';
import { NewLoanPage } from './pages/NewLoanPage.js';
import { LabelsPage } from './pages/LabelsPage.js';
import { SettingsPage } from './pages/SettingsPage.js';
import { LoginPage } from './pages/LoginPage.js';
import { AcceptInvitePage } from './pages/AcceptInvitePage.js';
import { UsersPage } from './pages/UsersPage.js';
import { AuthProvider, useAuth } from './auth/AuthContext.js';
import { Button } from './components/ui.js';

const navItems = [
  { to: '/', label: 'Assety', end: true },
  { to: '/loans', label: 'Výpůjčky' },
  { to: '/labels', label: 'Štítky' },
  { to: '/asset-types', label: 'Typy' },
  { to: '/locations', label: 'Lokace' },
  { to: '/users', label: 'Uživatelé', role: 'admin' as const },
  { to: '/settings', label: 'Nastavení', role: 'admin' as const },
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
      <header className="border-b bg-white sticky top-0 z-10 print:hidden">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-6">
          <NavLink to="/" className="font-semibold text-lg whitespace-nowrap">
            Inventory Hub
          </NavLink>
          <nav className="flex gap-1 text-sm overflow-x-auto flex-1">
            {navItems
              .filter((item) => !item.role || state.user.role === item.role)
              .map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    clsx(
                      'px-3 py-1.5 rounded transition-colors whitespace-nowrap',
                      isActive ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100',
                    )
                  }
                >
                  {item.label}
                </NavLink>
              ))}
          </nav>
          <UserMenu />
        </div>
      </header>
      <main className="flex-1">
        <div className="max-w-6xl mx-auto px-4 py-6">
          <Routes>
            <Route path="/" element={<AssetsPage />} />
            <Route path="/assets/new" element={<NewAssetPage />} />
            <Route path="/a/:code" element={<AssetDetailPage />} />
            <Route path="/asset-types" element={<AssetTypesPage />} />
            <Route path="/locations" element={<LocationsPage />} />
            <Route path="/loans" element={<LoansPage />} />
            <Route path="/loans/new" element={<NewLoanPage />} />
            <Route path="/loans/:id" element={<LoanDetailPage />} />
            <Route path="/labels" element={<LabelsPage />} />
            <Route path="/users" element={<UsersPage />} />
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
  return (
    <div className="flex items-center gap-3">
      <div className="text-right hidden sm:block">
        <div className="text-sm font-medium">{u.name}</div>
        <div className="text-xs text-slate-500">{u.role}</div>
      </div>
      {u.imageUrl ? (
        <img src={u.imageUrl} alt="" className="w-8 h-8 rounded-full" />
      ) : (
        <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-xs font-medium text-slate-700">
          {u.name.slice(0, 1).toUpperCase()}
        </div>
      )}
      <Button variant="ghost" onClick={() => logout()} className="text-xs">
        Odhlásit
      </Button>
    </div>
  );
}
