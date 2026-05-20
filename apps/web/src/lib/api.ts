import type { Asset, AssetStatus } from '@inventory-hub/shared';

type ApiOptions = {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
};

async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const res = await fetch(path, {
    method: opts.method ?? 'GET',
    headers: opts.body ? { 'content-type': 'application/json' } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: 'include',
    signal: opts.signal,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: res.statusText } }));
    throw new Error(err?.error?.message ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export type ListAssetsParams = {
  q?: string;
  status?: AssetStatus;
  includeArchived?: boolean;
};

export const apiClient = {
  health: () => api<{ status: string; time: string }>('/health'),
  org: {
    get: () =>
      api<{ initialized: boolean; settings?: { name: string; codePrefix: string | null } }>(
        '/api/org',
      ),
  },
  assets: {
    list: (params: ListAssetsParams = {}) => {
      const qs = new URLSearchParams();
      if (params.q) qs.set('q', params.q);
      if (params.status) qs.set('status', params.status);
      if (params.includeArchived) qs.set('includeArchived', 'true');
      const suffix = qs.toString() ? `?${qs}` : '';
      return api<{ items: Asset[] }>(`/api/assets${suffix}`);
    },
    get: (code: string) => api<{ asset: Asset }>(`/api/assets/${encodeURIComponent(code)}`),
  },
};
