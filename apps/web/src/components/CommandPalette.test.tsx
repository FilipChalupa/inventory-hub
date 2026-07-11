import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '../i18n/index.js';
import { AuthProvider } from '../auth/AuthContext.js';
import { CommandPalette, openCommandPalette } from './CommandPalette.js';

function renderPalette() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // Seed the auth query so AuthProvider resolves a user without hitting the network.
  qc.setQueryData(['auth', 'me'], {
    authenticated: true,
    user: { id: 'u1', email: 'a@b.cz', name: 'Admin', role: 'admin', imageUrl: null },
  });
  return render(
    <QueryClientProvider client={qc}>
      <I18nProvider>
        <MemoryRouter>
          <AuthProvider>
            <CommandPalette />
          </AuthProvider>
        </MemoryRouter>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

describe('CommandPalette', () => {
  it('opens on Ctrl+K and lists navigation items', () => {
    renderPalette();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // The "Go to" section header (cs) plus a known nav label are shown.
    expect(screen.getByText('Přejít na')).toBeInTheDocument();
    expect(screen.getByText('Přehled')).toBeInTheDocument();
  });

  it('opens imperatively and closes on Escape', () => {
    renderPalette();
    act(() => {
      openCommandPalette();
    });
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('filters navigation items by the query', () => {
    renderPalette();
    act(() => {
      openCommandPalette();
    });
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'kontakt' } });

    // "Kontakty" matches, "Přehled" does not.
    expect(screen.getByText('Kontakty')).toBeInTheDocument();
    expect(screen.queryByText('Přehled')).not.toBeInTheDocument();
  });
});
