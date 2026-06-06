import type {
  Asset,
  AssetStatus,
  CreateAssetInput,
  CreateDamageReportInput,
  CreateLoanInput,
  UpdateLoanInput,
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
  borrowerContactId: string | null;
  borrowerContact: string | null;
  purpose: string | null;
  loanedAt: string;
  startedAt: string | null;
  expectedReturnAt: string | null;
  createdByUserId: string;
  createdAt: string;
  items: LoanItemRow[];
  status: 'planned' | 'open' | 'partially_returned' | 'fully_returned';
};

export type ApiKeyRow = {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
};

export type LoanEventRow = {
  id: string;
  type: string;
  occurredAt: string;
  actorUserId: string | null;
  actorName: string | null;
  assetCode: string | null;
  payload: Record<string, unknown>;
};

export type LoanForAssetRow = {
  id: string;
  borrowerName: string;
  loanedAt: string;
  startedAt: string | null;
  expectedReturnAt: string | null;
  status: 'planned' | 'active';
};

export type LoanAvailabilityAsset = {
  id: string;
  code: string;
  name: string;
  status: AssetStatus;
  available: boolean;
  reason?: string;
};

export type ContactRow = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  organization: string | null;
  note: string | null;
  createdAt: string;
};

export type ContactInput = {
  name: string;
  email?: string | null;
  phone?: string | null;
  organization?: string | null;
  note?: string | null;
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

export type UserRow = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  imageUrl: string | null;
  disabledAt: string | null;
  createdAt: string;
};

export type ImportPreviewRow = {
  lineNumber: number;
  input: Record<string, string>;
  code?: string | null;
  issues: string[];
};
export type ImportResult = {
  preview: ImportPreviewRow[];
  hasErrors: boolean;
  created: number;
};

// TODO: Dočasné – odebrat po skončení potřeby demo seedování.
export type DemoSeedResult = {
  ok: true;
  summary: {
    assetTypesEnsured: number;
    locationsCreated: number;
    assetsCreated: number;
    contactsCreated: number;
    loansCreated: number;
    damageReportsCreated: number;
  };
};

async function uploadImportCsv(
  path: string,
  file: File,
  dryRun: boolean,
): Promise<ImportResult> {
  const form = new FormData();
  form.append('file', file);
  form.append('dryRun', dryRun ? 'true' : 'false');
  const res = await fetch(path, { method: 'POST', body: form, credentials: 'include' });
  const body = (await res.json().catch(() => null)) as unknown;
  if (body && typeof body === 'object' && 'preview' in body) {
    return body as ImportResult;
  }
  if (!res.ok) {
    const msg =
      body && typeof body === 'object' && 'error' in body
        ? (body as { error: { message: string } }).error.message
        : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return body as ImportResult;
}

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

  users: {
    list: () => api<{ items: UserRow[] }>('/api/users'),
    update: (id: string, input: { role?: UserRole; disabled?: boolean }) =>
      api<{ ok: true }>(`/api/users/${id}`, { method: 'PATCH', body: input }),
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
    assign: (code: string, userId: string) =>
      api<{ ok: true }>(`/api/assets/${encodeURIComponent(code)}/assign`, {
        method: 'POST',
        body: { userId },
      }),
    unassign: (code: string) =>
      api<{ ok: true }>(`/api/assets/${encodeURIComponent(code)}/unassign`, { method: 'POST' }),
    repairStart: (code: string) =>
      api<{ ok: true }>(`/api/assets/${encodeURIComponent(code)}/repair-start`, {
        method: 'POST',
      }),
    repairFinish: (code: string) =>
      api<{ ok: true }>(`/api/assets/${encodeURIComponent(code)}/repair-finish`, {
        method: 'POST',
      }),
    listExternalIds: (code: string) =>
      api<{ items: { id: string; kind: string; value: string }[] }>(
        `/api/assets/${encodeURIComponent(code)}/external-ids`,
      ),
    addExternalId: (code: string, input: { kind: string; value: string }) =>
      api<{ id: string; kind: string; value: string }>(
        `/api/assets/${encodeURIComponent(code)}/external-ids`,
        { method: 'POST', body: input },
      ),
    removeExternalId: (code: string, id: string) =>
      api<{ ok: true }>(`/api/assets/${encodeURIComponent(code)}/external-ids/${id}`, {
        method: 'DELETE',
      }),
    addPhoto: (code: string, path: string) =>
      api<{ photoPaths: string[] }>(`/api/assets/${encodeURIComponent(code)}/photos`, {
        method: 'POST',
        body: { path },
      }),
    removePhoto: (code: string, path: string) =>
      api<{ photoPaths: string[] }>(`/api/assets/${encodeURIComponent(code)}/photos`, {
        method: 'DELETE',
        body: { path },
      }),
    addDocument: (code: string, path: string) =>
      api<{ documentPaths: string[] }>(`/api/assets/${encodeURIComponent(code)}/documents`, {
        method: 'POST',
        body: { path },
      }),
    removeDocument: (code: string, path: string) =>
      api<{ documentPaths: string[] }>(`/api/assets/${encodeURIComponent(code)}/documents`, {
        method: 'DELETE',
        body: { path },
      }),
    events: (code: string) =>
      api<{ items: AssetEventRow[] }>(`/api/assets/${encodeURIComponent(code)}/events`),
    eventsAll: (limit = 200) =>
      api<{
        items: (AssetEventRow & { assetCode: string | null; assetName: string | null })[];
      }>(`/api/assets/events/all?limit=${limit}`),
    qrUrl: (code: string) => `/api/assets/${encodeURIComponent(code)}/qr`,
    labels: (codes: string[]) =>
      api<{ items: { code: string; name: string; qrUrl: string }[] }>('/api/assets/labels', {
        method: 'POST',
        body: { codes },
      }),
    import: (file: File, dryRun: boolean) => uploadImportCsv('/api/assets/import', file, dryRun),
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
    import: async (file: File, dryRun: boolean) => uploadImportCsv('/api/asset-types/import', file, dryRun),
  },

  locations: {
    list: () => api<{ items: LocationRow[] }>('/api/locations'),
    create: (input: { name: string; parentId?: string | null }) =>
      api<LocationRow>('/api/locations', { method: 'POST', body: input }),
    update: (id: string, input: { name?: string; parentId?: string | null }) =>
      api<{ ok: true }>(`/api/locations/${id}`, { method: 'PATCH', body: input }),
    remove: (id: string) => api<{ ok: true }>(`/api/locations/${id}`, { method: 'DELETE' }),
    import: async (file: File, dryRun: boolean) => uploadImportCsv('/api/locations/import', file, dryRun),
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

  contacts: {
    list: (q?: string) =>
      api<{ items: ContactRow[] }>(
        `/api/contacts${q ? `?q=${encodeURIComponent(q)}` : ''}`,
      ),
    get: (id: string) =>
      api<{ contact: ContactRow; loans: { id: string; borrowerName: string }[] }>(
        `/api/contacts/${id}`,
      ),
    create: (input: ContactInput) =>
      api<ContactRow>('/api/contacts', { method: 'POST', body: input }),
    update: (id: string, input: Partial<ContactInput>) =>
      api<{ ok: true }>(`/api/contacts/${id}`, { method: 'PATCH', body: input }),
    remove: (id: string) =>
      api<{ ok: true }>(`/api/contacts/${id}`, { method: 'DELETE' }),
  },

  loans: {
    list: (params: { q?: string; limit?: number; offset?: number } = {}) => {
      const qs = new URLSearchParams();
      if (params.q) qs.set('q', params.q);
      if (params.limit != null) qs.set('limit', String(params.limit));
      if (params.offset != null) qs.set('offset', String(params.offset));
      const suffix = qs.toString() ? `?${qs}` : '';
      return api<{ items: LoanRow[]; total: number }>(`/api/loans${suffix}`);
    },
    events: (id: string) =>
      api<{ items: LoanEventRow[] }>(`/api/loans/${id}/events`),
    get: (id: string) => api<{ loan: LoanRow }>(`/api/loans/${id}`),
    create: (input: CreateLoanInput) =>
      api<{ id: string }>('/api/loans', { method: 'POST', body: input }),
    update: (id: string, input: UpdateLoanInput) =>
      api<{ ok: true }>(`/api/loans/${id}`, { method: 'PATCH', body: input }),
    remove: (id: string) => api<{ ok: true }>(`/api/loans/${id}`, { method: 'DELETE' }),
    addItems: (id: string, assetCodes: string[]) =>
      api<{ ok: true; added: number }>(`/api/loans/${id}/items`, {
        method: 'POST',
        body: { assetCodes },
      }),
    removeItem: (loanId: string, itemId: string) =>
      api<{ ok: true }>(`/api/loans/${loanId}/items/${itemId}`, { method: 'DELETE' }),
    forAsset: (code: string) =>
      api<{ items: LoanForAssetRow[] }>(`/api/loans/for-asset/${encodeURIComponent(code)}`),
    availability: (params: { from?: string; to?: string; q?: string } = {}) => {
      const qs = new URLSearchParams();
      if (params.q) qs.set('q', params.q);
      if (params.from) qs.set('from', params.from);
      if (params.to) qs.set('to', params.to);
      const suffix = qs.toString() ? `?${qs}` : '';
      return api<{ items: LoanAvailabilityAsset[] }>(`/api/loans/availability${suffix}`);
    },
    start: (id: string) =>
      api<{ ok: true }>(`/api/loans/${id}/start`, { method: 'POST' }),
    returnAll: (id: string, returnedAt?: Date) =>
      api<{ ok: true; returned: number }>(`/api/loans/${id}/return-all`, {
        method: 'POST',
        body: { returnedAt },
      }),
    returnItem: (loanId: string, itemId: string, input: Omit<ReturnLoanItemInput, 'loanItemId'>) =>
      api<{ ok: true }>(`/api/loans/${loanId}/items/${itemId}/return`, {
        method: 'POST',
        body: input,
      }),
  },

  apiKeys: {
    list: () => api<{ items: ApiKeyRow[] }>('/api/api-keys'),
    create: (input: { name: string; expiresAt?: Date | null }) =>
      api<{ id: string; name: string; prefix: string; token: string }>('/api/api-keys', {
        method: 'POST',
        body: input,
      }),
    remove: (id: string) => api<{ ok: true }>(`/api/api-keys/${id}`, { method: 'DELETE' }),
  },

  // TODO: Dočasné – odebrat po skončení potřeby demo seedování.
  demo: {
    seed: () => api<DemoSeedResult>('/api/demo/seed', { method: 'POST' }),
  },
};
