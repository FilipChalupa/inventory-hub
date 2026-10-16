/**
 * Offline queue for inventory scans. In a warehouse the connection often
 * drops; a scan that can't reach the server is kept here (per session, in
 * localStorage so it survives a reload) and sent once the device is back
 * online. Failures the server reports (unknown code…) are kept too, so the
 * operator sees them instead of losing them silently.
 */

export type QueuedScan = { id: string; code: string; scannedAt: string };
export type FailedScan = QueuedScan & { error: string };
type State = { pending: QueuedScan[]; failed: FailedScan[] };

const EMPTY: State = { pending: [], failed: [] };
const key = (sessionId: string) => `ih.scanQueue.${sessionId}`;
const listeners = new Set<() => void>();
// useSyncExternalStore needs a stable snapshot per state; cache by raw JSON.
const snapshots = new Map<string, { raw: string | null; state: State }>();

function read(sessionId: string): State {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(key(sessionId));
  } catch {
    // storage unavailable — behave as empty
  }
  const cached = snapshots.get(sessionId);
  if (cached && cached.raw === raw) return cached.state;
  let state = EMPTY;
  try {
    if (raw) state = { ...EMPTY, ...(JSON.parse(raw) as State) };
  } catch {
    state = EMPTY;
  }
  snapshots.set(sessionId, { raw, state });
  return state;
}

function write(sessionId: string, state: State): void {
  try {
    if (state.pending.length === 0 && state.failed.length === 0) {
      localStorage.removeItem(key(sessionId));
    } else {
      localStorage.setItem(key(sessionId), JSON.stringify(state));
    }
  } catch {
    // quota / private mode: nothing more we can do
  }
  for (const l of listeners) l();
}

export const scanQueue = {
  get: read,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    // Another tab of the same app may change the queue too.
    const onStorage = (e: StorageEvent) => {
      if (e.key?.startsWith('ih.scanQueue.')) listener();
    };
    window.addEventListener('storage', onStorage);
    return () => {
      listeners.delete(listener);
      window.removeEventListener('storage', onStorage);
    };
  },
  /** Queues a scan; returns false if that code is already waiting. */
  enqueue(sessionId: string, code: string, scannedAt = new Date()): boolean {
    const state = read(sessionId);
    if (state.pending.some((p) => p.code === code)) return false;
    write(sessionId, {
      ...state,
      pending: [
        ...state.pending,
        { id: crypto.randomUUID(), code, scannedAt: scannedAt.toISOString() },
      ],
    });
    return true;
  },
  /** The server accepted it. */
  done(sessionId: string, id: string): void {
    const state = read(sessionId);
    write(sessionId, { ...state, pending: state.pending.filter((p) => p.id !== id) });
  },
  /** The server refused it for good (e.g. unknown code). */
  fail(sessionId: string, id: string, error: string): void {
    const state = read(sessionId);
    const item = state.pending.find((p) => p.id === id);
    if (!item) return;
    write(sessionId, {
      pending: state.pending.filter((p) => p.id !== id),
      failed: [...state.failed, { ...item, error }],
    });
  },
  clearFailed(sessionId: string): void {
    write(sessionId, { ...read(sessionId), failed: [] });
  },
};

/**
 * True when an error means "couldn't reach the server" (fetch rejects with a
 * TypeError) rather than an answer from it.
 */
export function isNetworkError(err: unknown): boolean {
  return err instanceof TypeError || (typeof navigator !== 'undefined' && !navigator.onLine);
}
