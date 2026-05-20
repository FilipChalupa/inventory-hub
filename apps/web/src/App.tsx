import { NavLink, Route, Routes } from 'react-router-dom';
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

const navItems = [
  { to: '/', label: 'Assety', end: true },
  { to: '/loans', label: 'Výpůjčky' },
  { to: '/labels', label: 'Štítky' },
  { to: '/asset-types', label: 'Typy' },
  { to: '/locations', label: 'Lokace' },
  { to: '/settings', label: 'Nastavení' },
];

export function App() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b bg-white sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-6">
          <NavLink to="/" className="font-semibold text-lg whitespace-nowrap">
            Inventory Hub
          </NavLink>
          <nav className="flex gap-1 text-sm overflow-x-auto">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  clsx(
                    'px-3 py-1.5 rounded transition-colors',
                    isActive ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100',
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
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
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}
