import type {
  Asset,
  AssetStatus,
  CreateAssetInput,
  CreateDamageReportInput,
  CreateLoanInput,
  ReturnLoanItemInput,
  AllowedDomain,
  UserRole,
  CustomFieldsSchema,
} from '@inventory-hub/shared';

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
  typeId?: string;
  locationId?: string;
  includeArchived?: boolean;
};

export type AssetTypeRow = {
  id: string;
  name: string;
  codePrefix: string;
  customFieldsSchema: CustomFieldsSchema;
};

export type LocationRow = {
  id: string;
  name: string;
  parentId: string | null;
};

export type AssetEventRow = {
  id: string;
  assetId: string;
  actorUserId: string | null;
  type: string;
  payload: Record<string, unknown>;
  occurredAt: string;
};

export type DamageReportRow = {
  id: string;
  assetId: string;
  occurredAt: string;
  reportedAt: string;
  reportedByUserId: string;
  description: string;
  severity: 'minor' | 'major' | 'total';
  photoPaths: string[];
  resolvedAt: string | null;
};

export type LoanItemRow = {
  id: string;
  loanId: string;
  assetId: string;
  returnedAt: string | null;
  returnCondition: 'ok' | 'damaged' | null;
  returnNotes: string | null;
  assetCode?: string;
  assetName?: string;
};

export type LoanRow = {
  id: string;
  borrowerName: string;
  borrowerUserId: string | null;
  borrowerContact: string | null;
  purpose: string | null;
  loanedAt: string;
  expectedReturnAt: string | null;
  createdByUserId: string;
  createdAt: string;
  items: LoanItemRow[];
  status: 'open' | 'partially_returned' | 'fully_returned';
};

export type AuthMe =
  | { authenticated: false }
  | {
      authenticated: true;
      user: { id: string; email: string; name: string; role: UserRole; imageUrl: string | null };
    };

export type InvitationRow = {
  id: string;
  email: string;
  role: UserRole;
  token: string;
  invitedByUserId: string;
  acceptedAt: string | null;
  expiresAt: string;
  createdAt: string;
};

export async function uploadFile(file: File): Promise<{ path: string; url: string }> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch('/api/uploads', {
    method: 'POST',
    body: form,
    credentials: 'include',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: res.statusText } }));
    throw new Error(err?.error?.message ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ path: string; url: string }>;
}

export const apiClient = {
  health: () => api<{ status: string; time: string }>('/health'),

  auth: {
    me: () => api<AuthMe>('/auth/me'),
    logout: () => api<{ ok: true }>('/auth/logout', { method: 'POST' }),
    googleStartUrl: '/auth/google/start',
    devLogin: (email: string) =>
      api<{ ok: true; user: { id: string; email: string; name: string; role: UserRole } }>(
        '/auth/dev-login',
        { method: 'POST', body: { email } },
      ),
    getInvite: (token: string) =>
      api<{ email: string; role: UserRole }>(`/auth/invite/${encodeURIComponent(token)}`),
    acceptInvite: (token: string, name: string) =>
      api<{ ok: true }>('/auth/accept-invite', { method: 'POST', body: { token, name } }),
  },

  invitations: {
    list: () => api<{ items: InvitationRow[] }>('/api/invitations'),
    create: (input: { email: string; role: UserRole }) =>
      api<{ id: string; email: string; role: UserRole; acceptUrl: string }>(
        '/api/invitations',
        { method: 'POST', body: input },
      ),
    remove: (id: string) =>
      api<{ ok: true }>(`/api/invitations/${id}`, { method: 'DELETE' }),
  },

  org: {
    get: () =>
      api<{
        initialized: boolean;
        settings?: { name: string; codePrefix: string | null; allowedDomains: AllowedDomain[] };
      }>('/api/org'),
    put: (input: { name: string; codePrefix: string | null; allowedDomains: AllowedDomain[] }) =>
      api<{ ok: true }>('/api/org', { method: 'PUT', body: input }),
  },

  assets: {
    list: (params: ListAssetsParams = {}) => {
      const qs = new URLSearchParams();
      if (params.q) qs.set('q', params.q);
      if (params.status) qs.set('status', params.status);
      if (params.typeId) qs.set('typeId', params.typeId);
      if (params.locationId) qs.set('locationId', params.locationId);
      if (params.includeArchived) qs.set('includeArchived', 'true');
      const suffix = qs.toString() ? `?${qs}` : '';
      return api<{ items: Asset[] }>(`/api/assets${suffix}`);
    },
    get: (code: string) => api<{ asset: Asset }>(`/api/assets/${encodeURIComponent(code)}`),
    create: (input: CreateAssetInput) =>
      api<{ code: string; id: string }>('/api/assets', { method: 'POST', body: input }),
    update: (
      code: string,
      input: {
        name?: string;
        typeId?: string | null;
        locationId?: string | null;
        notes?: string | null;
        customFields?: Record<string, unknown>;
      },
    ) =>
      api<{ ok: true }>(`/api/assets/${encodeURIComponent(code)}`, {
        method: 'PATCH',
        body: input,
      }),
    archive: (code: string, status: 'sold' | 'lost' | 'retired' | 'damaged', note?: string) =>
      api<{ ok: true }>(`/api/assets/${encodeURIComponent(code)}/archive`, {
        method: 'POST',
        body: { status, note },
      }),
    unarchive: (code: string) =>
      api<{ ok: true }>(`/api/assets/${encodeURIComponent(code)}/unarchive`, { method: 'POST' }),
    events: (code: string) =>
      api<{ items: AssetEventRow[] }>(`/api/assets/${encodeURIComponent(code)}/events`),
    qrUrl: (code: string) => `/api/assets/${encodeURIComponent(code)}/qr`,
    labels: (codes: string[]) =>
      api<{ items: { code: string; name: string; qrUrl: string }[] }>('/api/assets/labels', {
        method: 'POST',
        body: { codes },
      }),
  },

  assetTypes: {
    list: () => api<{ items: AssetTypeRow[] }>('/api/asset-types'),
    create: (input: { name: string; codePrefix: string; customFieldsSchema?: CustomFieldsSchema }) =>
      api<AssetTypeRow>('/api/asset-types', { method: 'POST', body: input }),
    update: (
      id: string,
      input: { name?: string; codePrefix?: string; customFieldsSchema?: CustomFieldsSchema },
    ) => api<{ ok: true }>(`/api/asset-types/${id}`, { method: 'PATCH', body: input }),
    remove: (id: string) =>
      api<{ ok: true }>(`/api/asset-types/${id}`, { method: 'DELETE' }),
  },

  locations: {
    list: () => api<{ items: LocationRow[] }>('/api/locations'),
    create: (input: { name: string; parentId?: string | null }) =>
      api<LocationRow>('/api/locations', { method: 'POST', body: input }),
    remove: (id: string) => api<{ ok: true }>(`/api/locations/${id}`, { method: 'DELETE' }),
  },

  damages: {
    listByAsset: (code: string) =>
      api<{ items: DamageReportRow[] }>(`/api/damages/by-asset/${encodeURIComponent(code)}`),
    create: (code: string, input: CreateDamageReportInput) =>
      api<{ id: string }>(`/api/damages/by-asset/${encodeURIComponent(code)}`, {
        method: 'POST',
        body: input,
      }),
    resolve: (id: string) =>
      api<{ ok: true }>(`/api/damages/${id}/resolve`, { method: 'POST' }),
  },

  loans: {
    list: () => api<{ items: LoanRow[] }>('/api/loans'),
    get: (id: string) => api<{ loan: LoanRow }>(`/api/loans/${id}`),
    create: (input: CreateLoanInput) =>
      api<{ id: string }>('/api/loans', { method: 'POST', body: input }),
    returnItem: (loanId: string, itemId: string, input: Omit<ReturnLoanItemInput, 'loanItemId'>) =>
      api<{ ok: true }>(`/api/loans/${loanId}/items/${itemId}/return`, {
        method: 'POST',
        body: input,
      }),
  },
};
