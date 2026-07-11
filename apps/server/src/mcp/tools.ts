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
  addLoanItemsInput,
  createAssetInput,
  createDamageReportInput,
  createLoanInput,
  orgSettingsSchema,
  returnLoanItemInput,
  updateLoanInput,
} from '@inventory-hub/shared';

export type ToolAccess = 'read' | 'write';

export type ToolRequest = { method: string; path: string; body?: unknown };

export type McpTool = {
  name: string;
  description: string;
  access: ToolAccess;
  /** Raw Zod shape registered as the tool's input schema. */
  inputShape: z.ZodRawShape;
  build: (args: Record<string, any>) => ToolRequest;
  /**
   * Optional post-processor applied to a successful response body before it is
   * returned to the MCP client. Used to inject human-facing deep-link `url`
   * fields (the app's public base URL isn't known to the routers themselves).
   */
  enrich?: (body: unknown, appUrl: string) => unknown;
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
): McpTool {
  return { name, access, description, inputShape, build, enrich };
}

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
    'List/search assets. Filter by free text, status, type, location.',
    {
      q: z.string().optional(),
      status: z.enum(ASSET_STATUSES).optional(),
      typeId: z.string().uuid().optional(),
      locationId: z.string().uuid().optional(),
      includeArchived: z.boolean().optional(),
    },
    (a) => ({ method: 'GET', path: `/api/assets${qs(a)}` }),
    enrichAssets,
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
    'Get the event timeline for an asset (created/updated/assigned/loan/damage…).',
    { code: z.string() },
    (a) => ({ method: 'GET', path: `/api/assets/${encodeURIComponent(a.code)}/events` }),
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

  // ---- loans ---------------------------------------------------------------
  tool(
    'list_loans',
    'read',
    'List/search loans by borrower name. Each loan includes a `url` deep link.',
    {
      q: z.string().optional(),
      limit: z.number().int().positive().optional(),
      offset: z.number().int().nonnegative().optional(),
    },
    (a) => ({ method: 'GET', path: `/api/loans${qs(a)}` }),
    enrichLoans,
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
  tool(
    'report_damage',
    'write',
    'Report damage on an asset code.',
    (() => {
      const { assetId: _assetId, ...rest } = shapeOf(createDamageReportInput);
      return { ...rest, code: z.string() };
    })(),
    ({ code, ...body }) => ({
      method: 'POST',
      path: `/api/damages/by-asset/${encodeURIComponent(code)}`,
      body,
    }),
  ),
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
