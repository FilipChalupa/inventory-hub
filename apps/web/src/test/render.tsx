import { render, type RenderOptions } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { I18nProvider } from '../i18n/index.js';

/** render() wrapped in I18nProvider, for components that call useT(). */
export function renderWithI18n(ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>) {
  return render(ui, {
    wrapper: ({ children }: { children: ReactNode }) => <I18nProvider>{children}</I18nProvider>,
    ...options,
  });
}
