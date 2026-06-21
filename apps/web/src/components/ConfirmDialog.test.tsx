import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ConfirmViewport, confirm } from './ConfirmDialog.js';

describe('ConfirmDialog', () => {
  it('resolves true when the confirm action is clicked', async () => {
    render(<ConfirmViewport />);
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
    render(<ConfirmViewport />);
    let p!: Promise<boolean>;
    act(() => {
      p = confirm({ title: 'Pokračovat?' });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Zrušit' }));
    expect(await p).toBe(false);
  });

  it('resolves false on Escape', async () => {
    render(<ConfirmViewport />);
    let p!: Promise<boolean>;
    act(() => {
      p = confirm({ title: 'Zavřít?' });
    });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(await p).toBe(false);
  });
});
