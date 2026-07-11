import type {
  Asset,
  AssetStatus,
  CreateAssetInput,
  CreateDamageReportInput,
  CreateLoanInput,
  RequestLoanInput,
  UpdateLoanInput,
  ReturnLoanItemInput,
  AllowedDomain,
  LabelSettings,
  UserRole,
  CustomFieldsSchema,
  CreateInventorySessionInput,
  UpdateInventorySessionInput,
  InventorySessionStatus,
  ScanResultKind,
  ApiKeyScope,
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

export type BulkAssetsInput = {
  action: 'archive' | 'move' | 'assign' | 'unassign';
  assetCodes: string[];
  locationId?: string | null;
  userId?: string | null;
  status?: 'sold' | 'lost' | 'retired' | 'damaged';
};

export type ListAssetsParams = {
  q?: string;
  status?: AssetStatus;
  typeId?: string;
  locationId?: string;
  assignedToUserId?: string;
  includeArchived?: boolean;
  limit?: number;
  offset?: number;
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
  requestedByUserId: string | null;
  approvedAt: string | null;
  createdByUserId: string;
  createdAt: string;
  items: LoanItemRow[];
  status: 'requested' | 'planned' | 'open' | 'partially_returned' | 'fully_returned';
};

export type ApiKeyRow = {
  id: string;
  name: string;
  prefix: string;
  scopes: ApiKeyScope[];
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

export type LoanCalendarWindow = {
  loanId: string;
  borrowerName: string;
  start: string;
  end: string | null;
  status: 'planned' | 'active';
};

export type LoanCalendarAsset = {
  id: string;
  code: string;
  name: string;
  status: AssetStatus;
  windows: LoanCalendarWindow[];
};

export type LoanScheduleRow = {
  id: string;
  borrowerName: string;
  start: string;
  end: string | null;
  status: 'planned' | 'open' | 'partially_returned' | 'fully_returned';
  itemCount: number;
};

export type LoanTodayBucket = {
  id: string;
  borrowerName: string;
  itemCount: number;
  date: string;
};

export type LoansToday = {
  overdue: LoanTodayBucket[];
  dueToday: LoanTodayBucket[];
  startingToday: LoanTodayBucket[];
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

export type InventorySessionRow = {
  id: string;
  name: string;
  locationId: string | null;
  typeIds: string[] | null;
  assetIds: string[] | null;
  status: InventorySessionStatus;
  note: string | null;
  startedByUserId: string | null;
  closedAt: string | null;
  closedByUserId: string | null;
  createdAt: string;
  scanCount?: number;
};

export type InventoryReportAsset = {
  id: string;
  code: string;
  name: string;
  status: AssetStatus;
  locationId: string | null;
  scannedAt: string | null;
  note: string | null;
};

export type InventoryReport = {
  counts: { expected: number; found: number; missing: number; unexpected: number };
  found: InventoryReportAsset[];
  missing: InventoryReportAsset[];
  unexpected: InventoryReportAsset[];
};

export type ScanResult = {
  result: ScanResultKind;
  asset: {
    id: string;
    code: string;
    name: string;
    status: AssetStatus;
    locationId: string | null;
  };
  report: InventoryReport;
};

async function uploadImportCsv(path: string, file: File, dryRun: boolean): Promise<ImportResult> {
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

export type DashboardStats = {
  totalActive: number;
  byStatus: { status: AssetStatus; count: number }[];
  byType: { typeId: string | null; typeName: string; count: number }[];
  byLocation: { locationId: string; locationName: string; count: number }[];
  loans: { active: number; overdue: number; planned: number };
  inRepair: number;
  // Financial figures are admin/operator-only; null for members/auditors.
  totalValue: number | null;
  totalCurrentValue: number | null;
  valueByType: { typeId: string; typeName: string; value: number }[] | null;
  warrantyExpiringSoon: number;
  serviceDueSoon: number;
  currency: string;
};

export type NotificationSeverity = 'info' | 'warning' | 'danger';

export type NotificationItem = {
  id: string;
  type: 'overdue_loan' | 'warranty' | 'service' | 'damage';
  severity: NotificationSeverity;
  title: string;
  message: string;
  link: string;
  at: string;
};

export type NotificationFeed = {
  items: NotificationItem[];
  unreadCount: number;
};

export const apiClient = {
  health: () => api<{ status: string; time: string }>('/health'),

  auth: {
    me: () => api<AuthMe>('/auth/me'),
    config: () => api<{ googleConfigured: boolean; devLoginEnabled: boolean }>('/auth/config'),
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
      api<{ id: string; email: string; role: UserRole; acceptUrl: string }>('/api/invitations', {
        method: 'POST',
        body: input,
      }),
    remove: (id: string) => api<{ ok: true }>(`/api/invitations/${id}`, { method: 'DELETE' }),
  },

  users: {
    list: () => api<{ items: UserRow[] }>('/api/users'),
    update: (id: string, input: { role?: UserRole; disabled?: boolean }) =>
      api<{ ok: true }>(`/api/users/${id}`, { method: 'PATCH', body: input }),
    exportData: (id: string) => api<Record<string, unknown>>(`/api/users/${id}/export`),
    anonymize: (id: string) => api<{ ok: true }>(`/api/users/${id}/anonymize`, { method: 'POST' }),
  },

  org: {
    get: () =>
      api<{
        initialized: boolean;
        appUrl?: string;
        backupsConfigured?: boolean;
        settings?: {
          name: string;
          codePrefix: string | null;
          allowedDomains: AllowedDomain[];
          publicLookupEnabled: boolean;
          webhookUrl: string | null;
          webhookSecretSet: boolean;
        };
        labelSettings: LabelSettings;
      }>('/api/org'),
    put: (input: {
      name: string;
      codePrefix: string | null;
      allowedDomains: AllowedDomain[];
      publicLookupEnabled: boolean;
      webhookUrl: string | null;
      webhookSecret: string | null;
    }) => api<{ ok: true }>('/api/org', { method: 'PUT', body: input }),
    putLabelSettings: (input: LabelSettings) =>
      api<{ ok: true }>('/api/org/label-settings', { method: 'PUT', body: input }),
    mcpInfo: () => api<{ url: string; googleConfigured: boolean }>('/api/org/mcp-info'),
  },

  assets: {
    list: (params: ListAssetsParams = {}) => {
      const qs = new URLSearchParams();
      if (params.q) qs.set('q', params.q);
      if (params.status) qs.set('status', params.status);
      if (params.typeId) qs.set('typeId', params.typeId);
      if (params.locationId) qs.set('locationId', params.locationId);
      if (params.assignedToUserId) qs.set('assignedToUserId', params.assignedToUserId);
      if (params.includeArchived) qs.set('includeArchived', 'true');
      if (params.limit != null) qs.set('limit', String(params.limit));
      if (params.offset != null) qs.set('offset', String(params.offset));
      const suffix = qs.toString() ? `?${qs}` : '';
      return api<{ items: (Asset & { id: string })[]; total: number }>(`/api/assets${suffix}`);
    },
    get: (code: string) =>
      api<{
        asset: Asset;
        children: { code: string; name: string; status: AssetStatus }[];
        parent: { code: string; name: string } | null;
      }>(`/api/assets/${encodeURIComponent(code)}`),
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
        purchasedAt?: string | Date | null;
        warrantyUntil?: string | Date | null;
        purchasePrice?: number | null;
        supplier?: string | null;
        serviceIntervalDays?: number | null;
        lastServicedAt?: string | Date | null;
        usefulLifeMonths?: number | null;
        parentAssetId?: string | null;
      },
    ) =>
      api<{ ok: true }>(`/api/assets/${encodeURIComponent(code)}`, {
        method: 'PATCH',
        body: input,
      }),
    service: (code: string) =>
      api<{ ok: true }>(`/api/assets/${encodeURIComponent(code)}/service`, { method: 'POST' }),
    bulk: (input: BulkAssetsInput) =>
      api<{ updated: number }>('/api/assets/bulk', { method: 'POST', body: input }),
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
        total: number;
      }>(`/api/assets/events/all?limit=${limit}`),
    qrUrl: (code: string, opts: { compact?: boolean } = {}) =>
      `/api/assets/${encodeURIComponent(code)}/qr${opts.compact ? '?compact=1' : ''}`,
    labels: (codes: string[]) =>
      api<{ items: { code: string; name: string; qrUrl: string }[] }>('/api/assets/labels', {
        method: 'POST',
        body: { codes },
      }),
    import: (file: File, dryRun: boolean) => uploadImportCsv('/api/assets/import', file, dryRun),
  },

  assetTypes: {
    list: () => api<{ items: AssetTypeRow[] }>('/api/asset-types'),
    create: (input: {
      name: string;
      codePrefix: string;
      customFieldsSchema?: CustomFieldsSchema;
    }) => api<AssetTypeRow>('/api/asset-types', { method: 'POST', body: input }),
    update: (
      id: string,
      input: { name?: string; codePrefix?: string; customFieldsSchema?: CustomFieldsSchema },
    ) => api<{ ok: true }>(`/api/asset-types/${id}`, { method: 'PATCH', body: input }),
    remove: (id: string) => api<{ ok: true }>(`/api/asset-types/${id}`, { method: 'DELETE' }),
    import: async (file: File, dryRun: boolean) =>
      uploadImportCsv('/api/asset-types/import', file, dryRun),
  },

  locations: {
    list: () => api<{ items: LocationRow[] }>('/api/locations'),
    create: (input: { name: string; parentId?: string | null }) =>
      api<LocationRow>('/api/locations', { method: 'POST', body: input }),
    update: (id: string, input: { name?: string; parentId?: string | null }) =>
      api<{ ok: true }>(`/api/locations/${id}`, { method: 'PATCH', body: input }),
    remove: (id: string) => api<{ ok: true }>(`/api/locations/${id}`, { method: 'DELETE' }),
    import: async (file: File, dryRun: boolean) =>
      uploadImportCsv('/api/locations/import', file, dryRun),
  },

  damages: {
    listByAsset: (code: string) =>
      api<{ items: DamageReportRow[] }>(`/api/damages/by-asset/${encodeURIComponent(code)}`),
    create: (code: string, input: CreateDamageReportInput) =>
      api<{ id: string }>(`/api/damages/by-asset/${encodeURIComponent(code)}`, {
        method: 'POST',
        body: input,
      }),
    resolve: (id: string) => api<{ ok: true }>(`/api/damages/${id}/resolve`, { method: 'POST' }),
  },

  contacts: {
    list: (q?: string) =>
      api<{ items: ContactRow[] }>(`/api/contacts${q ? `?q=${encodeURIComponent(q)}` : ''}`),
    get: (id: string) =>
      api<{ contact: ContactRow; loans: { id: string; borrowerName: string }[] }>(
        `/api/contacts/${id}`,
      ),
    create: (input: ContactInput) =>
      api<ContactRow>('/api/contacts', { method: 'POST', body: input }),
    update: (id: string, input: Partial<ContactInput>) =>
      api<{ ok: true }>(`/api/contacts/${id}`, { method: 'PATCH', body: input }),
    remove: (id: string) => api<{ ok: true }>(`/api/contacts/${id}`, { method: 'DELETE' }),
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
    events: (id: string) => api<{ items: LoanEventRow[] }>(`/api/loans/${id}/events`),
    get: (id: string) => api<{ loan: LoanRow }>(`/api/loans/${id}`),
    create: (input: CreateLoanInput) =>
      api<{ id: string }>('/api/loans', { method: 'POST', body: input }),
    request: (input: RequestLoanInput) =>
      api<{ id: string }>('/api/loans/request', { method: 'POST', body: input }),
    approve: (id: string) => api<{ ok: true }>(`/api/loans/${id}/approve`, { method: 'POST' }),
    reject: (id: string) => api<{ ok: true }>(`/api/loans/${id}/reject`, { method: 'POST' }),
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
    calendar: (
      params: {
        q?: string;
        freeFrom?: string;
        freeTo?: string;
        limit?: number;
        offset?: number;
      } = {},
    ) => {
      const qs = new URLSearchParams();
      if (params.q) qs.set('q', params.q);
      if (params.freeFrom) qs.set('freeFrom', params.freeFrom);
      if (params.freeTo) qs.set('freeTo', params.freeTo);
      if (params.limit != null) qs.set('limit', String(params.limit));
      if (params.offset != null) qs.set('offset', String(params.offset));
      const suffix = qs.toString() ? `?${qs}` : '';
      return api<{ items: LoanCalendarAsset[]; total: number }>(`/api/loans/calendar${suffix}`);
    },
    today: () => api<LoansToday>('/api/loans/today'),
    schedule: (params: { from?: string; to?: string } = {}) => {
      const qs = new URLSearchParams();
      if (params.from) qs.set('from', params.from);
      if (params.to) qs.set('to', params.to);
      const suffix = qs.toString() ? `?${qs}` : '';
      return api<{ items: LoanScheduleRow[] }>(`/api/loans/schedule${suffix}`);
    },
    availability: (params: { from?: string; to?: string; q?: string } = {}) => {
      const qs = new URLSearchParams();
      if (params.q) qs.set('q', params.q);
      if (params.from) qs.set('from', params.from);
      if (params.to) qs.set('to', params.to);
      const suffix = qs.toString() ? `?${qs}` : '';
      return api<{ items: LoanAvailabilityAsset[] }>(`/api/loans/availability${suffix}`);
    },
    start: (id: string) => api<{ ok: true }>(`/api/loans/${id}/start`, { method: 'POST' }),
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

  inventory: {
    list: () => api<{ items: InventorySessionRow[] }>('/api/inventory'),
    get: (id: string) =>
      api<{ session: InventorySessionRow; report: InventoryReport }>(`/api/inventory/${id}`),
    create: (input: CreateInventorySessionInput) =>
      api<{ session: InventorySessionRow }>('/api/inventory', { method: 'POST', body: input }),
    update: (id: string, input: UpdateInventorySessionInput) =>
      api<{ ok: true }>(`/api/inventory/${id}`, { method: 'PATCH', body: input }),
    scan: (id: string, code: string) =>
      api<ScanResult>(`/api/inventory/${id}/scan`, { method: 'POST', body: { code } }),
    setItemNote: (id: string, assetId: string, note: string) =>
      api<{ ok: true; report: InventoryReport }>(
        `/api/inventory/${id}/items/${encodeURIComponent(assetId)}/note`,
        { method: 'PUT', body: { note } },
      ),
    close: (id: string) => api<{ ok: true }>(`/api/inventory/${id}/close`, { method: 'POST' }),
    reopen: (id: string) => api<{ ok: true }>(`/api/inventory/${id}/reopen`, { method: 'POST' }),
    markLost: (id: string, codes: string[]) =>
      api<{ ok: true; archived: number; report: InventoryReport }>(
        `/api/inventory/${id}/mark-lost`,
        { method: 'POST', body: { codes } },
      ),
  },

  stats: {
    get: () => api<DashboardStats>('/api/stats'),
  },

  notifications: {
    list: () => api<NotificationFeed>('/api/notifications'),
    markSeen: () => api<{ ok: true }>('/api/notifications/seen', { method: 'POST' }),
  },

  apiKeys: {
    list: () => api<{ items: ApiKeyRow[] }>('/api/api-keys'),
    create: (input: { name: string; scopes: ApiKeyScope[]; expiresAt?: Date | null }) =>
      api<{ id: string; name: string; prefix: string; scopes: ApiKeyScope[]; token: string }>(
        '/api/api-keys',
        { method: 'POST', body: input },
      ),
    remove: (id: string) => api<{ ok: true }>(`/api/api-keys/${id}`, { method: 'DELETE' }),
  },
};
