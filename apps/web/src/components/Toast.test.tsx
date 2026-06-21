import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { act } from 'react';
import { renderWithI18n } from '../test/render.js';
import { ToastViewport, toast } from './Toast.js';

describe('Toast', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    // Flush any lingering toasts so the module-level store is empty for the
    // next test, then restore real timers.
    act(() => vi.advanceTimersByTime(10_000));
    vi.useRealTimers();
  });

  it('shows a success toast', () => {
    renderWithI18n(<ToastViewport />);
    act(() => {
      toast.success('Uloženo');
    });
    expect(screen.getByText('Uloženo')).toBeInTheDocument();
  });

  it('dismisses on the close button', () => {
    renderWithI18n(<ToastViewport />);
    act(() => {
      toast.error('Chyba');
    });
    expect(screen.getByText('Chyba')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Zavřít' }));
    expect(screen.queryByText('Chyba')).not.toBeInTheDocument();
  });

  it('auto-dismisses a success toast after its timeout', () => {
    renderWithI18n(<ToastViewport />);
    act(() => {
      toast.success('Zmizí');
    });
    expect(screen.getByText('Zmizí')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(4000));
    expect(screen.queryByText('Zmizí')).not.toBeInTheDocument();
  });
});
