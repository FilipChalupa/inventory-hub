import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithI18n } from '../test/render.js';
import { ErrorBoundary } from './ErrorBoundary.js';

describe('ErrorBoundary', () => {
  beforeEach(() => {
    // React logs caught render errors to console.error; silence the noise.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('renders children when nothing throws', () => {
    renderWithI18n(
      <ErrorBoundary>
        <div>obsah</div>
      </ErrorBoundary>,
    );
    expect(screen.getByText('obsah')).toBeInTheDocument();
  });

  it('shows the fallback with the error message when a child throws', () => {
    function Boom(): never {
      throw new Error('kaboom');
    }
    renderWithI18n(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Něco se pokazilo')).toBeInTheDocument();
    expect(screen.getByText('kaboom')).toBeInTheDocument();
  });

  it('recovers via "Zkusit znovu" once the child stops throwing', () => {
    let crash = true;
    function Boom() {
      if (crash) throw new Error('kaboom');
      return <div>zotaveno</div>;
    }
    renderWithI18n(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Něco se pokazilo')).toBeInTheDocument();

    crash = false;
    fireEvent.click(screen.getByRole('button', { name: 'Zkusit znovu' }));
    expect(screen.getByText('zotaveno')).toBeInTheDocument();
  });
});
