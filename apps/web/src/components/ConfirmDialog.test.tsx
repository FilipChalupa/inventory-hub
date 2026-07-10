import { describe, it, expect } from 'vitest';
import { screen, fireEvent, act } from '@testing-library/react';
import { renderWithI18n } from '../test/render.js';
import { ConfirmViewport, confirm } from './ConfirmDialog.js';

describe('ConfirmDialog', () => {
  it('resolves true when the confirm action is clicked', async () => {
    renderWithI18n(<ConfirmViewport />);
    let p!: Promise<boolean>;
    act(() => {
      p = confirm({ title: 'Smazat položku?', confirmLabel: 'Smazat', danger: true });
    });
    expect(screen.getByText('Smazat položku?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Smazat' }));
    expect(await p).toBe(true);
    // Dialog is gone after resolving.
    expect(screen.queryByText('Smazat položku?')).not.toBeInTheDocument();
  });

  it('resolves false when cancelled', async () => {
    renderWithI18n(<ConfirmViewport />);
    let p!: Promise<boolean>;
    act(() => {
      p = confirm({ title: 'Pokračovat?' });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Zrušit' }));
    expect(await p).toBe(false);
  });

  it('resolves false on Escape', async () => {
    renderWithI18n(<ConfirmViewport />);
    let p!: Promise<boolean>;
    act(() => {
      p = confirm({ title: 'Zavřít?' });
    });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(await p).toBe(false);
  });

  it('focuses the confirm button on open and restores focus on close', async () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);

    renderWithI18n(<ConfirmViewport />);
    let p!: Promise<boolean>;
    act(() => {
      p = confirm({ title: 'Pokračovat?' });
    });
    // Confirm button is autofocused while the dialog is open.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Potvrdit' }));

    fireEvent.click(screen.getByRole('button', { name: 'Zrušit' }));
    expect(await p).toBe(false);
    // Focus returns to whatever opened the dialog.
    expect(document.activeElement).toBe(opener);

    opener.remove();
  });
});
