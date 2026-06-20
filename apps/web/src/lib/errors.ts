/**
 * Safe human-readable message for an unknown thrown value. Mutations and
 * queries can reject with anything; never assume it's an `Error` (doing
 * `(err as Error).message` blank-screens the app when it isn't).
 */
export function errorMessage(err: unknown, fallback = 'Něco se nepovedlo'): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err) return err;
  if (err && typeof err === 'object' && 'message' in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === 'string' && m) return m;
  }
  return fallback;
}
