/**
 * MCP tool registry.
 *
 * Each tool maps to an existing API route. Tools are tagged `read`/`write`;
 * write tools require the `mcp:write` scope (chosen by the user at pairing
 * time). Role-based authorization (admin/operator/…) is enforced downstream by
 * the routers themselves, so it is not duplicated here.
 *
 * Input shapes reuse the shared Zod schemas where they exist for precision;
 * the routers re-validate every payload regardless.
 */
import { z } from 'zod';
import {
  ASSET_STATUSES,
  TERMINAL_ASSET_STATUSES,
  addLoanItemsInput,
  createAssetInput,
  createDamageReportInput,
  createInventorySessionInput,
  createLoanInput,
  markMissingLostInput,
  MAX_DAMAGE_PHOTOS,
  orgSettingsSchema,
  requestLoanInput,
  returnLoanItemInput,
  updateLoanInput,
} from '@inventory-hub/shared';

export type ToolAccess = 'read' | 'write';

export type ToolRequest = { method: string; path: string; body?: unknown };

export type ToolCallResult = { status: number; ok: boolean; body: unknown };

/** In-process API access handed to multi-step tools. */
export type ToolContext = {
  call: (method: string, path: string, body?: unknown) => Promise<ToolCallResult>;
  callRaw: (
    path: string,
  ) => Promise<{ status: number; ok: boolean; bytes: Buffer; contentType: string | null }>;
};

/** A tool result that may carry images for the model to look at. */
export type ToolOutcome = ToolCallResult & { images?: { data: string; mimeType: string }[] };

export type McpTool = {
  name: string;
  description: string;
  access: ToolAccess;
  /** Raw Zod shape registered as the tool's input schema. */
  inputShape: z.ZodRawShape;
  build: (args: Record<string, any>) => ToolRequest;
  /**
   * Multi-step tools (upload, then attach…) implement `run` instead of a
   * single request; `build` then only declares the primary route for the
   * dispatch-coverage test.
   */
  run?: (args: Record<string, any>, ctx: ToolContext) => Promise<ToolOutcome>;
  /**
   * Optional post-processor applied to a successful response body before it is
   * returned to the MCP client. Used to inject human-facing deep-link `url`
   * fields (the app's public base URL isn't known to the routers themselves).
   */
  enrich?: (body: unknown, appUrl: string) => unknown;
  /**
   * Optional final reshaping of a successful response (after `enrich`): trims
   * list rows to the essentials and adds paging hints, so a list call doesn't
   * flood the model's context window.
   */
  shape?: (body: any, args: Record<string, any>) => unknown;
};

/**
 * Extracts the raw object shape from a Zod schema, unwrapping `.refine()`
 * (ZodEffects) wrappers so refined shared schemas can be reused as tool inputs.
 */
function shapeOf(schema: z.ZodTypeAny): z.ZodRawShape {
  const def = (schema as { _def?: { typeName?: string; schema?: z.ZodTypeAny } })._def;
  if (def?.typeName === 'ZodEffects' && def.schema) return shapeOf(def.schema);
  if (def?.typeName === 'ZodObject') return (schema as unknown as z.ZodObject<z.ZodRawShape>).shape;
  throw new Error('shapeOf: not an object schema');
}

/** Build a query string from defined values only. */
function qs(params: Record<string, unknown>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

function tool(
  name: string,
  access: ToolAccess,
  description: string,
  inputShape: z.ZodRawShape,
  build: (args: Record<string, any>) => ToolRequest,
  enrich?: (body: unknown, appUrl: string) => unknown,
  shape?: McpTool['shape'],
): McpTool {
  return { name, access, description, inputShape, build, enrich, shape };
}

// ---- images ------------------------------------------------------------------

/** Where an image comes from: inline base64 or a public URL the server fetches. */
const imageSource = z.object({
  imageBase64: z
    .string()
    .max(8_000_000)
    .optional()
    .describe('Image bytes as base64 (a data: URL prefix is fine).'),
  imageUrl: z.string().url().optional().describe('Public http(s) URL of the image.'),
});
type ImageSource = z.infer<typeof imageSource>;

/** Stores an image via POST /api/uploads/import; images only. */
async function importImage(
  call: ToolContext['call'],
  src: ImageSource,
): Promise<{ ok: true; path: string } | (ToolCallResult & { ok: false })> {
  if (Boolean(src.imageBase64) === Boolean(src.imageUrl)) {
    return {
      ok: false,
      status: 400,
      body: { error: { message: 'Give exactly one of imageBase64 or imageUrl.' } },
    };
  }
  const res = await call(
    'POST',
    '/api/uploads/import',
    src.imageBase64 ? { dataBase64: src.imageBase64 } : { url: src.imageUrl },
  );
  if (!res.ok) return { ...res, ok: false };
  const body = res.body as { path: string; contentType?: string };
  if (!body.contentType?.startsWith('image/')) {
    return {
      ok: false,
      status: 415,
      body: { error: { message: 'Only images can be attached as photos.' } },
    };
  }
  return { ok: true, path: body.path };
}

/** Prefixes an error message with which input caused it. */
function withContext(res: ToolCallResult, where: string): ToolCallResult {
  const msg = (res.body as any)?.error?.message ?? 'failed';
  return { ...res, body: { error: { message: `${where}: ${msg}` } } };
}

// ---- response size control -------------------------------------------------

/** Paging inputs shared by list tools. */
const paging = (defaultLimit: number) => ({
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe(`Max rows to return (default ${defaultLimit}, max 100).`),
  offset: z.number().int().min(0).optional().describe('Rows to skip, for paging.'),
});

/**
 * Trims `{ items, total? }` to compact rows plus paging hints. `slice` pages
 * locally for routes that have no limit/offset of their own.
 */
function paged<T>(project: (row: any) => T, defaultLimit: number, opts: { slice?: boolean } = {}) {
  return (body: any, args: Record<string, any>) => {
    const all: any[] = Array.isArray(body?.items) ? body.items : [];
    const limit = args.limit ?? defaultLimit;
    const offset = args.offset ?? 0;
    const rows = opts.slice ? all.slice(offset, offset + limit) : all;
    const total: number = typeof body?.total === 'number' ? body.total : all.length;
    const nextOffset = offset + rows.length < total ? offset + rows.length : null;
    return { total, offset, returned: rows.length, nextOffset, items: rows.map(project) };
  };
}

const compactAsset = (a: any) => ({
  code: a.code,
  name: a.name,
  status: a.status,
  typeId: a.typeId,
  locationId: a.locationId,
  assignedToUserId: a.assignedToUserId,
  ...(a.parentAssetId ? { parentAssetId: a.parentAssetId } : {}),
  ...(a.archivedAt ? { archived: true } : {}),
  url: a.url,
});

const compactLoan = (l: any) => ({
  id: l.id,
  borrowerName: l.borrowerName,
  status: l.status,
  purpose: l.purpose ?? undefined,
  startedAt: l.startedAt ?? undefined,
  expectedReturnAt: l.expectedReturnAt ?? undefined,
  itemCount: Array.isArray(l.items) ? l.items.length : undefined,
  openItemCount: Array.isArray(l.items)
    ? l.items.filter((i: any) => !i.returnedAt).length
    : undefined,
  url: l.url,
});

/**
 * Behaviour hints for clients (MCP tool annotations): destructive tools make
 * a careful client ask before running them; idempotent ones are safe to retry.
 */
export const DESTRUCTIVE_TOOLS = new Set([
  'archive_asset',
  'bulk_update_assets',
  'cancel_loan',
  'reject_reservation',
  'delete_contact',
  'mark_inventory_missing_lost',
  'update_org_settings',
  'update_user',
  'revoke_invitation',
  'remove_asset_photo',
  'remove_asset_external_id',
]);
export const IDEMPOTENT_TOOLS = new Set([
  'update_asset',
  'archive_asset',
  'unarchive_asset',
  'assign_asset',
  'unassign_asset',
  'update_loan',
  'update_contact',
  'update_asset_type',
  'update_location',
  'scan_inventory_item',
  'close_inventory',
  'reopen_inventory',
  'update_org_settings',
  'update_user',
  'remove_asset_photo',
]);

const stripSlash = (u: string) => u.replace(/\/$/, '');
const assetUrl = (appUrl: string, code: string) => `${stripSlash(appUrl)}/a/${code}`;
const loanUrl = (appUrl: string, id: string) => `${stripSlash(appUrl)}/loans/${id}`;

/** Adds a deep-link `url` to an asset response (`{ asset }` or `{ items }`). */
function enrichAssets(body: unknown, appUrl: string): unknown {
  const b = body as {
    asset?: { code?: string; url?: string };
    items?: { code?: string; url?: string }[];
  };
  if (b && typeof b === 'object') {
    if (b.asset?.code) b.asset.url = assetUrl(appUrl, b.asset.code);
    if (Array.isArray(b.items)) {
      for (const it of b.items) if (it?.code) it.url = assetUrl(appUrl, it.code);
    }
  }
  return body;
}

/** Adds a deep-link `url` to a loan response (`{ loan }` or `{ items }`). */
function enrichLoans(body: unknown, appUrl: string): unknown {
  const b = body as {
    loan?: { id?: string; url?: string };
    items?: { id?: string; url?: string }[];
  };
  if (b && typeof b === 'object') {
    if (b.loan?.id) b.loan.url = loanUrl(appUrl, b.loan.id);
    if (Array.isArray(b.items)) {
      for (const it of b.items) if (it?.id) it.url = loanUrl(appUrl, it.id);
    }
  }
  return body;
}

export const MCP_TOOLS: McpTool[] = [
  // ---- assets --------------------------------------------------------------
  tool(
    'list_assets',
    'read',
    'List/search assets. `q` matches code, name, custom-field values and external IDs (serial numbers, EAN…) as substrings. Filter by status, type, location. Returns compact rows (code, name, status, ids, url) with paging info; use get_asset for full details.',
    {
      q: z.string().optional(),
      status: z.enum(ASSET_STATUSES).optional(),
      typeId: z.string().uuid().optional(),
      locationId: z.string().uuid().optional(),
      includeArchived: z.boolean().optional(),
      ...paging(25),
    },
    (a) => ({ method: 'GET', path: `/api/assets${qs({ ...a, limit: a.limit ?? 25 })}` }),
    enrichAssets,
    paged(compactAsset, 25),
  ),
  tool(
    'find_asset_by_identifier',
    'read',
    'Exact lookup of an asset by any identifier — asset code, serial number, EAN, SKU or other external ID, or a custom-field value — ignoring case and separators (spaces, dashes…). Each match says what it matched on. Use this for "which asset has serial X"; use list_assets for fuzzy search.',
    {
      value: z.string().min(1),
      kind: z
        .string()
        .optional()
        .describe('Only this external-ID kind, e.g. "serial" or "ean". Omit to search everything.'),
    },
    (a) => ({ method: 'GET', path: `/api/assets/lookup${qs(a)}` }),
    enrichAssets,
    (body) => ({
      items: (body?.items ?? []).map((a: any) => ({ ...compactAsset(a), matchedOn: a.matchedOn })),
    }),
  ),
  tool(
    'list_asset_external_ids',
    'read',
    "List an asset's external identifiers (serial number, EAN, manufacturer SKU…).",
    { code: z.string() },
    (a) => ({ method: 'GET', path: `/api/assets/${encodeURIComponent(a.code)}/external-ids` }),
  ),
  tool(
    'add_asset_external_id',
    'write',
    'Attach an external identifier to an asset (admin/operator). `kind` is free text; the app uses "serial", "ean", "sku" and "other". A kind+value pair is unique across the organization.',
    { code: z.string(), kind: z.string().min(1).max(40), value: z.string().min(1).max(200) },
    ({ code, ...body }) => ({
      method: 'POST',
      path: `/api/assets/${encodeURIComponent(code)}/external-ids`,
      body,
    }),
  ),
  tool(
    'remove_asset_external_id',
    'write',
    'Remove an external identifier from an asset (admin/operator); `id` comes from list_asset_external_ids.',
    { code: z.string(), id: z.string() },
    ({ code, id }) => ({
      method: 'DELETE',
      path: `/api/assets/${encodeURIComponent(code)}/external-ids/${encodeURIComponent(id)}`,
    }),
  ),
  tool(
    'get_asset',
    'read',
    'Get a single asset by its code, including custom fields, status and a `url` deep link to its detail page.',
    { code: z.string() },
    (a) => ({ method: 'GET', path: `/api/assets/${encodeURIComponent(a.code)}` }),
    enrichAssets,
  ),
  tool(
    'get_asset_events',
    'read',
    'Get the event timeline for an asset (created/updated/assigned/loan/damage…), newest first. `via` names the AI agent when one performed the action.',
    { code: z.string(), ...paging(30) },
    (a) => ({ method: 'GET', path: `/api/assets/${encodeURIComponent(a.code)}/events` }),
    undefined,
    paged((e) => e, 30, { slice: true }),
  ),
  tool(
    'create_asset',
    'write',
    'Create a new asset. If a typeId is given the code is auto-generated.',
    shapeOf(createAssetInput),
    (a) => ({ method: 'POST', path: '/api/assets', body: a }),
  ),
  tool(
    'update_asset',
    'write',
    'Update an asset (name/type/location/notes/customFields) by code.',
    {
      code: z.string(),
      name: z.string().min(1).max(200).optional(),
      typeId: z.string().uuid().nullable().optional(),
      locationId: z.string().uuid().nullable().optional(),
      notes: z.string().max(2000).nullable().optional(),
      customFields: z.record(z.string(), z.unknown()).optional(),
    },
    ({ code, ...body }) => ({
      method: 'PATCH',
      path: `/api/assets/${encodeURIComponent(code)}`,
      body,
    }),
  ),
  tool(
    'archive_asset',
    'write',
    'Archive an asset (terminal status). Optionally provide a status and note.',
    { code: z.string(), status: z.enum(ASSET_STATUSES).optional(), note: z.string().optional() },
    ({ code, ...body }) => ({
      method: 'POST',
      path: `/api/assets/${encodeURIComponent(code)}/archive`,
      body,
    }),
  ),
  tool(
    'unarchive_asset',
    'write',
    'Restore a previously archived asset.',
    { code: z.string() },
    (a) => ({ method: 'POST', path: `/api/assets/${encodeURIComponent(a.code)}/unarchive` }),
  ),
  tool(
    'assign_asset',
    'write',
    'Assign an asset to an internal user.',
    { code: z.string(), userId: z.string() },
    ({ code, ...body }) => ({
      method: 'POST',
      path: `/api/assets/${encodeURIComponent(code)}/assign`,
      body,
    }),
  ),
  tool(
    'unassign_asset',
    'write',
    'Unassign an asset from its current user.',
    { code: z.string() },
    (a) => ({ method: 'POST', path: `/api/assets/${encodeURIComponent(a.code)}/unassign` }),
  ),
  tool(
    'record_service',
    'write',
    'Record a completed service on an asset (advances its next-service date).',
    { code: z.string() },
    (a) => ({ method: 'POST', path: `/api/assets/${encodeURIComponent(a.code)}/service` }),
  ),
  tool(
    'bulk_update_assets',
    'write',
    'Bulk action on many asset codes: move (locationId), assign (userId), unassign, or archive (status).',
    {
      action: z.enum(['move', 'assign', 'unassign', 'archive']),
      assetCodes: z.array(z.string()).min(1).max(500),
      locationId: z.string().uuid().nullable().optional(),
      userId: z.string().uuid().nullable().optional(),
      status: z.enum(TERMINAL_ASSET_STATUSES).optional(),
    },
    (a) => ({ method: 'POST', path: '/api/assets/bulk', body: a }),
  ),

  // ---- loans ---------------------------------------------------------------
  tool(
    'list_loans',
    'read',
    'List/search loans by borrower name, newest first. Returns compact rows (borrower, status, dates, item counts, url) with paging info; use get_loan for items.',
    {
      q: z.string().optional(),
      ...paging(20),
    },
    (a) => ({ method: 'GET', path: `/api/loans${qs({ ...a, limit: a.limit ?? 20 })}` }),
    enrichLoans,
    paged(compactLoan, 20),
  ),
  tool(
    'get_loan',
    'read',
    'Get a loan by id, including its items, status and a `url` deep link to its detail page.',
    { id: z.string() },
    (a) => ({ method: 'GET', path: `/api/loans/${encodeURIComponent(a.id)}` }),
    enrichLoans,
  ),
  tool(
    'check_availability',
    'read',
    'List assets and whether they are loanable in a given time window.',
    { from: z.string(), to: z.string() },
    (a) => ({ method: 'GET', path: `/api/loans/availability${qs(a)}` }),
  ),
  tool(
    'create_loan',
    'write',
    'Create a loan (immediate or planned) for one or more asset codes.',
    shapeOf(createLoanInput),
    (a) => ({ method: 'POST', path: '/api/loans', body: a }),
  ),
  tool(
    'update_loan',
    'write',
    'Update a loan (borrower/contact/purpose/dates).',
    { ...shapeOf(updateLoanInput), id: z.string() },
    ({ id, ...body }) => ({ method: 'PATCH', path: `/api/loans/${encodeURIComponent(id)}`, body }),
  ),
  tool(
    'cancel_loan',
    'write',
    'Cancel a planned loan (fails if it already started).',
    { id: z.string() },
    (a) => ({ method: 'DELETE', path: `/api/loans/${encodeURIComponent(a.id)}` }),
  ),
  tool(
    'add_loan_items',
    'write',
    'Add more asset codes to an existing loan.',
    { ...shapeOf(addLoanItemsInput), id: z.string() },
    ({ id, ...body }) => ({
      method: 'POST',
      path: `/api/loans/${encodeURIComponent(id)}/items`,
      body,
    }),
  ),
  tool(
    'start_loan',
    'write',
    'Manually activate a planned loan now (moves items to on-loan).',
    { id: z.string() },
    (a) => ({ method: 'POST', path: `/api/loans/${encodeURIComponent(a.id)}/start` }),
  ),
  tool(
    'return_all_loan_items',
    'write',
    'Return all open items of a loan in good condition. Optional backdated returnedAt.',
    { id: z.string(), returnedAt: z.string().optional() },
    ({ id, ...body }) => ({
      method: 'POST',
      path: `/api/loans/${encodeURIComponent(id)}/return-all`,
      body,
    }),
  ),
  tool(
    'return_loan_item',
    'write',
    'Return a single loan item, optionally as damaged (creates a damage report).',
    { ...shapeOf(returnLoanItemInput), loanId: z.string(), itemId: z.string() },
    ({ loanId, itemId, ...body }) => ({
      method: 'POST',
      path: `/api/loans/${encodeURIComponent(loanId)}/items/${encodeURIComponent(itemId)}/return`,
      body,
    }),
  ),
  tool(
    'request_reservation',
    'write',
    'Request a self-service reservation for asset codes and a time window (awaits approval).',
    shapeOf(requestLoanInput),
    (a) => ({ method: 'POST', path: '/api/loans/request', body: a }),
    enrichLoans,
  ),
  tool(
    'approve_reservation',
    'write',
    'Approve a pending reservation request into a planned loan.',
    { id: z.string() },
    (a) => ({ method: 'POST', path: `/api/loans/${encodeURIComponent(a.id)}/approve` }),
    enrichLoans,
  ),
  tool(
    'reject_reservation',
    'write',
    'Reject a pending reservation request.',
    { id: z.string() },
    (a) => ({ method: 'POST', path: `/api/loans/${encodeURIComponent(a.id)}/reject` }),
    enrichLoans,
  ),

  // ---- contacts ------------------------------------------------------------
  tool(
    'list_contacts',
    'read',
    'List/search contacts by name or organization.',
    { q: z.string().optional() },
    (a) => ({ method: 'GET', path: `/api/contacts${qs(a)}` }),
  ),
  tool(
    'get_contact',
    'read',
    'Get a contact by id, including recent loans.',
    { id: z.string() },
    (a) => ({ method: 'GET', path: `/api/contacts/${encodeURIComponent(a.id)}` }),
  ),
  tool(
    'create_contact',
    'write',
    'Create a contact.',
    {
      name: z.string().min(1),
      email: z.string().email().optional(),
      phone: z.string().optional(),
      organization: z.string().optional(),
      note: z.string().optional(),
    },
    (a) => ({ method: 'POST', path: '/api/contacts', body: a }),
  ),
  tool(
    'update_contact',
    'write',
    'Update a contact by id.',
    {
      id: z.string(),
      name: z.string().min(1).optional(),
      email: z.string().email().nullable().optional(),
      phone: z.string().nullable().optional(),
      organization: z.string().nullable().optional(),
      note: z.string().nullable().optional(),
    },
    ({ id, ...body }) => ({
      method: 'PATCH',
      path: `/api/contacts/${encodeURIComponent(id)}`,
      body,
    }),
  ),
  tool('delete_contact', 'write', 'Delete a contact by id.', { id: z.string() }, (a) => ({
    method: 'DELETE',
    path: `/api/contacts/${encodeURIComponent(a.id)}`,
  })),

  // ---- damages -------------------------------------------------------------
  tool(
    'list_asset_damages',
    'read',
    'List damage reports for an asset code.',
    { code: z.string() },
    (a) => ({ method: 'GET', path: `/api/damages/by-asset/${encodeURIComponent(a.code)}` }),
  ),
  {
    ...tool(
      'report_damage',
      'write',
      'Report damage on an asset code. Optionally attach up to 10 photos, each given as `imageBase64` or a public `imageUrl`.',
      (() => {
        const { assetId: _assetId, photoPaths: _paths, ...rest } = shapeOf(createDamageReportInput);
        return {
          ...rest,
          code: z.string(),
          photos: z.array(imageSource).max(MAX_DAMAGE_PHOTOS).optional(),
        };
      })(),
      ({ code }) => ({ method: 'POST', path: `/api/damages/by-asset/${encodeURIComponent(code)}` }),
    ),
    run: async ({ code, photos, ...body }, { call }) => {
      const photoPaths: string[] = [];
      for (const [i, photo] of ((photos ?? []) as ImageSource[]).entries()) {
        const up = await importImage(call, photo);
        if (!up.ok) return withContext(up, `photos[${i}]`);
        photoPaths.push(up.path);
      }
      return call('POST', `/api/damages/by-asset/${encodeURIComponent(code)}`, {
        ...body,
        photoPaths,
      });
    },
  },

  // ---- photos --------------------------------------------------------------
  {
    ...tool(
      'add_asset_photo',
      'write',
      "Attach a photo to an asset (admin/operator). Give the image as `imageBase64` (raw base64 or a data: URL) or as a public https `imageUrl` the server downloads. JPEG, PNG, WebP or GIF; max size is the server's upload limit.",
      { code: z.string(), ...imageSource.shape },
      ({ code }) => ({ method: 'POST', path: `/api/assets/${encodeURIComponent(code)}/photos` }),
    ),
    run: async ({ code, ...source }, { call }) => {
      const up = await importImage(call, source as ImageSource);
      if (!up.ok) return up;
      return call('POST', `/api/assets/${encodeURIComponent(code)}/photos`, { path: up.path });
    },
  },
  tool(
    'remove_asset_photo',
    'write',
    "Detach a photo from an asset (admin/operator). `path` is one of the asset's photoPaths.",
    { code: z.string(), path: z.string() },
    ({ code, path }) => ({
      method: 'DELETE',
      path: `/api/assets/${encodeURIComponent(code)}/photos`,
      body: { path },
    }),
  ),
  {
    ...tool(
      'get_asset_photo',
      'read',
      "Fetch one of an asset's photos as an image you can look at (e.g. to judge its condition). `index` picks from photoPaths (default 0, the first).",
      { code: z.string(), index: z.number().int().min(0).optional() },
      ({ code }) => ({ method: 'GET', path: `/api/assets/${encodeURIComponent(code)}` }),
    ),
    run: async ({ code, index = 0 }, { call, callRaw }) => {
      const res = await call('GET', `/api/assets/${encodeURIComponent(code)}`);
      if (!res.ok) return res;
      const paths = ((res.body as any)?.asset?.photoPaths ?? []) as string[];
      const path = paths[index];
      if (!path) {
        return {
          ok: false,
          status: 404,
          body: { error: { message: `Asset has ${paths.length} photo(s); no index ${index}.` } },
        };
      }
      const file = await callRaw(`/api/uploads/${path}`);
      const mimeType = file.contentType?.split(';')[0] ?? '';
      if (!file.ok || !mimeType.startsWith('image/')) {
        return {
          ok: false,
          status: file.ok ? 415 : file.status,
          body: { error: { message: 'Photo unavailable.' } },
        };
      }
      return {
        ok: true,
        status: 200,
        body: { code, index, path, photoCount: paths.length, mimeType, bytes: file.bytes.length },
        images: [{ data: file.bytes.toString('base64'), mimeType }],
      };
    },
  },
  tool(
    'resolve_damage',
    'write',
    'Mark a damage report resolved by id.',
    { id: z.string() },
    (a) => ({ method: 'POST', path: `/api/damages/${encodeURIComponent(a.id)}/resolve` }),
  ),

  // ---- asset types ---------------------------------------------------------
  tool('list_asset_types', 'read', 'List all asset types.', {}, () => ({
    method: 'GET',
    path: '/api/asset-types',
  })),
  tool(
    'create_asset_type',
    'write',
    'Create an asset type (name, codePrefix, optional customFieldsSchema).',
    {
      name: z.string().min(1),
      codePrefix: z.string().optional(),
      customFieldsSchema: z.array(z.unknown()).optional(),
    },
    (a) => ({ method: 'POST', path: '/api/asset-types', body: a }),
  ),
  tool(
    'update_asset_type',
    'write',
    'Update an asset type by id.',
    {
      id: z.string(),
      name: z.string().min(1).optional(),
      codePrefix: z.string().nullable().optional(),
      customFieldsSchema: z.array(z.unknown()).optional(),
    },
    ({ id, ...body }) => ({
      method: 'PATCH',
      path: `/api/asset-types/${encodeURIComponent(id)}`,
      body,
    }),
  ),

  // ---- locations -----------------------------------------------------------
  tool('list_locations', 'read', 'List locations (hierarchical).', {}, () => ({
    method: 'GET',
    path: '/api/locations',
  })),
  tool(
    'create_location',
    'write',
    'Create a location, optionally under a parent.',
    { name: z.string().min(1), parentId: z.string().nullable().optional() },
    (a) => ({ method: 'POST', path: '/api/locations', body: a }),
  ),
  tool(
    'update_location',
    'write',
    'Update a location by id.',
    {
      id: z.string(),
      name: z.string().min(1).optional(),
      parentId: z.string().nullable().optional(),
    },
    ({ id, ...body }) => ({
      method: 'PATCH',
      path: `/api/locations/${encodeURIComponent(id)}`,
      body,
    }),
  ),

  // ---- dashboard -----------------------------------------------------------
  tool(
    'get_stats',
    'read',
    'Inventory overview: total active assets, counts by status/type/location, loan totals (active/overdue/planned), assets in repair, warranty-expiring and service-due counts, and total & current (depreciated) inventory value in the configured currency.',
    {},
    () => ({ method: 'GET', path: '/api/stats' }),
  ),
  tool(
    'get_utilization',
    'read',
    'Loan-utilization report (admin/operator only): most-borrowed assets and live assets that have never been loaned.',
    {},
    () => ({ method: 'GET', path: '/api/stats/utilization' }),
  ),
  tool(
    'get_notifications',
    'read',
    "The current user's to-do feed: overdue loans, expiring warranties, due services and open damage reports (members see only their own).",
    {},
    () => ({ method: 'GET', path: '/api/notifications' }),
  ),

  // ---- inventory (stock-take) sessions -------------------------------------
  tool(
    'list_inventories',
    'read',
    'List inventory (stock-take) sessions, newest first, with their scan counts.',
    { ...paging(20) },
    () => ({ method: 'GET', path: '/api/inventory' }),
    undefined,
    paged(
      (s) => ({
        id: s.id,
        name: s.name,
        status: s.status,
        locationId: s.locationId,
        scanCount: s.scanCount,
        createdAt: s.createdAt,
        closedAt: s.closedAt ?? undefined,
      }),
      20,
      { slice: true },
    ),
  ),
  tool(
    'get_inventory',
    'read',
    'Get an inventory session with its live report: counts plus found, missing and unexpected assets (each list capped at maxPerList; `omitted` says how many were cut).',
    {
      id: z.string(),
      maxPerList: z.number().int().min(0).max(1000).optional().describe('Default 100.'),
    },
    (a) => ({ method: 'GET', path: `/api/inventory/${encodeURIComponent(a.id)}` }),
    undefined,
    (body, args) => {
      const max = args.maxPerList ?? 100;
      const report = body?.report;
      if (!report) return body;
      const omitted: Record<string, number> = {};
      for (const key of ['found', 'missing', 'unexpected'] as const) {
        const list = report[key];
        if (Array.isArray(list) && list.length > max) {
          omitted[key] = list.length - max;
          report[key] = list.slice(0, max);
        }
      }
      return Object.keys(omitted).length ? { ...body, omitted } : body;
    },
  ),
  tool(
    'create_inventory',
    'write',
    'Start an inventory session (admin/operator). Scope by locationId and/or typeIds, or list exact assetCodes; omit all to cover the whole organization.',
    createInventorySessionInput.shape,
    (a) => ({ method: 'POST', path: '/api/inventory', body: a }),
  ),
  tool(
    'scan_inventory_item',
    'write',
    'Record an asset as found in an open inventory session (admin/operator). Idempotent.',
    { id: z.string(), code: z.string() },
    ({ id, code }) => ({
      method: 'POST',
      path: `/api/inventory/${encodeURIComponent(id)}/scan`,
      body: { code },
    }),
  ),
  tool(
    'close_inventory',
    'write',
    'Close an inventory session (admin/operator).',
    { id: z.string() },
    (a) => ({ method: 'POST', path: `/api/inventory/${encodeURIComponent(a.id)}/close` }),
  ),
  tool(
    'reopen_inventory',
    'write',
    'Reopen a closed inventory session (admin/operator).',
    { id: z.string() },
    (a) => ({ method: 'POST', path: `/api/inventory/${encodeURIComponent(a.id)}/reopen` }),
  ),
  tool(
    'mark_inventory_missing_lost',
    'write',
    'Mark assets that an inventory session did not find as lost (admin/operator).',
    { id: z.string(), ...markMissingLostInput.shape },
    ({ id, ...body }) => ({
      method: 'POST',
      path: `/api/inventory/${encodeURIComponent(id)}/mark-lost`,
      body,
    }),
  ),

  // ---- org / users / invitations (admin-gated downstream) ------------------
  tool(
    'get_org_settings',
    'read',
    'Read organization settings. Returns `appUrl`, the public web base URL for building human-facing links such as `${appUrl}/a/<code>` (asset) and `${appUrl}/loans/<id>` (loan).',
    {},
    () => ({ method: 'GET', path: '/api/org' }),
  ),
  tool(
    'update_org_settings',
    'write',
    'Update organization settings (admin only).',
    shapeOf(orgSettingsSchema),
    (a) => ({ method: 'PUT', path: '/api/org', body: a }),
  ),
  tool('list_users', 'read', 'List users (admin/auditor only).', {}, () => ({
    method: 'GET',
    path: '/api/users',
  })),
  tool(
    'update_user',
    'write',
    'Update a user role / disabled flag (admin only).',
    {
      id: z.string(),
      role: z.enum(['admin', 'operator', 'member', 'auditor']).optional(),
      disabled: z.boolean().optional(),
    },
    ({ id, ...body }) => ({ method: 'PATCH', path: `/api/users/${encodeURIComponent(id)}`, body }),
  ),
  tool('list_invitations', 'read', 'List invitations (admin only).', {}, () => ({
    method: 'GET',
    path: '/api/invitations',
  })),
  tool(
    'create_invitation',
    'write',
    'Invite a new user by email with a role (admin only).',
    { email: z.string().email(), role: z.enum(['admin', 'operator', 'member', 'auditor']) },
    (a) => ({ method: 'POST', path: '/api/invitations', body: a }),
  ),
  tool(
    'revoke_invitation',
    'write',
    'Revoke a pending invitation by id (admin only).',
    { id: z.string() },
    (a) => ({ method: 'DELETE', path: `/api/invitations/${encodeURIComponent(a.id)}` }),
  ),
];
