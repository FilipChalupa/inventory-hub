import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App.js';
import { I18nProvider } from './i18n/index.js';
import { ToastViewport, toast } from './components/Toast.js';
import { ConfirmViewport } from './components/ConfirmDialog.js';
import { errorMessage } from './lib/errors.js';
import './index.css';

// Register service worker in production builds only. In dev, Vite serves
// fresh modules with HMR and a SW would cache them aggressively.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.error('Service worker registration failed:', err);
    });
  });
}

const queryClient = new QueryClient({
  // Surface every failed mutation as an error toast, so an action never fails
  // silently. Pages may still show their own inline error; the toast is the
  // safety net (especially for confirm-driven deletes with no inline slot).
  mutationCache: new MutationCache({
    onError: (error) => toast.error(errorMessage(error)),
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Missing #root element');

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <BrowserRouter>
          <App />
          <ToastViewport />
          <ConfirmViewport />
        </BrowserRouter>
      </I18nProvider>
    </QueryClientProvider>
  </StrictMode>,
);
