import { Component, type ReactNode } from 'react';
import { Button, Card } from './ui.js';
import { errorMessage } from '../lib/errors.js';

type Props = { children: ReactNode };
type State = { error: unknown };

/**
 * Catches render-time crashes in the page subtree and shows a recoverable
 * fallback instead of a blank white screen. Wrapped with a `key` on the route
 * path so navigating away clears a crashed page automatically.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error };
  }

  override componentDidCatch(error: unknown) {
    // Surface to the console for debugging; the UI shows a friendly message.
    console.error('Render error caught by ErrorBoundary:', error);
  }

  override render() {
    if (this.state.error == null) return this.props.children;
    return (
      <Card className="max-w-xl mx-auto mt-8 border-red-300">
        <h1 className="text-lg font-semibold text-red-700 dark:text-red-300">
          Něco se pokazilo
        </h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          Tuhle stránku se nepodařilo zobrazit. Zkus to prosím znovu, nebo se vrať na úvod.
        </p>
        <p className="mt-2 break-words rounded bg-slate-100 p-2 font-mono text-xs text-slate-600 dark:bg-slate-900 dark:text-slate-400">
          {errorMessage(this.state.error)}
        </p>
        <div className="mt-4 flex gap-2">
          <Button onClick={() => this.setState({ error: null })}>Zkusit znovu</Button>
          <Button variant="secondary" onClick={() => (window.location.href = '/')}>
            Domů
          </Button>
        </div>
      </Card>
    );
  }
}
