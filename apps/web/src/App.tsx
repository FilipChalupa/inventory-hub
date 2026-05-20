import { Link, Route, Routes } from 'react-router-dom';
import { AssetsPage } from './pages/AssetsPage.js';
import { AssetDetailPage } from './pages/AssetDetailPage.js';

export function App() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b bg-white">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link to="/" className="font-semibold text-lg">
            Inventory Hub
          </Link>
          <nav className="flex gap-4 text-sm text-slate-600">
            <Link to="/" className="hover:text-slate-900">
              Assety
            </Link>
          </nav>
        </div>
      </header>
      <main className="flex-1">
        <div className="max-w-6xl mx-auto px-4 py-6">
          <Routes>
            <Route path="/" element={<AssetsPage />} />
            <Route path="/a/:code" element={<AssetDetailPage />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}
