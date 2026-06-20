/**
 * OpenAPI 3 description of the integration-facing REST API.
 *
 * Request/response schemas are derived from the shared Zod schemas via
 * `zod-to-json-schema`, so they can't drift from validation. The path list
 * is curated (the main resources integrators use). Served at `/openapi.json`;
 * `/docs` renders it with a self-hosted Swagger UI (no external CDN).
 */
import swaggerUiDist from 'swagger-ui-dist';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ZodTypeAny } from 'zod';
import {
  assetSchema,
  createAssetInput,
  loanSchema,
  createLoanInput,
  updateLoanInput,
  addLoanItemsInput,
  returnLoanItemInput,
  createApiKeyInput,
  createInventorySessionInput,
  updateInventorySessionInput,
  importPayloadSchema,
  importResultSchema,
} from '@inventory-hub/shared';

/** Directory of the bundled Swagger UI static assets. */
export const SWAGGER_UI_DIR = swaggerUiDist.getAbsoluteFSPath();

const j = (schema: ZodTypeAny) =>
  zodToJsonSchema(schema, { target: 'openApi3', $refStrategy: 'none' });

const bearer = [{ bearerAuth: [] }];

const ok = (description: string, schema?: unknown) => ({
  description,
  ...(schema ? { content: { 'application/json': { schema } } } : {}),
});

const jsonBody = (schema: unknown) => ({
  required: true,
  content: { 'application/json': { schema } },
});

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });

export function openApiDocument() {
  return {
    openapi: '3.0.3',
    info: {
      title: 'Inventory Hub API',
      version: '1.0.0',
      description:
        'REST API for assets and loans. Authenticate with an API key as ' +
        '`Authorization: Bearer <token>` (create keys in Settings → API klíče). ' +
        'A key acts with the role of the admin who created it.',
    },
    servers: [{ url: '/' }],
    security: bearer,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description: 'API key issued in Settings. Sent as `Authorization: Bearer ihk_…`.',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: { error: { type: 'object', properties: { message: { type: 'string' } } } },
        },
        Asset: j(assetSchema),
        CreateAsset: j(createAssetInput),
        Loan: j(loanSchema),
        CreateLoan: j(createLoanInput),
        UpdateLoan: j(updateLoanInput),
        AddLoanItems: j(addLoanItemsInput),
        // The route omits loanItemId (it's in the URL path).
        ReturnLoanItem: j(returnLoanItemInput.omit({ loanItemId: true })),
        CreateApiKey: j(createApiKeyInput),
        CreateInventorySession: j(createInventorySessionInput),
        UpdateInventorySession: j(updateInventorySessionInput),
        ImportPayload: j(importPayloadSchema),
        ImportResult: j(importResultSchema),
        CreateAssetType: {
          type: 'object',
          required: ['name', 'codePrefix'],
          properties: {
            name: { type: 'string' },
            codePrefix: { type: 'string' },
            customFieldsSchema: { type: 'array', items: { type: 'object' } },
          },
        },
        CreateLocation: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string' },
            parentId: { type: 'string', nullable: true },
          },
        },
        CreateContact: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string' },
            email: { type: 'string', nullable: true },
            phone: { type: 'string', nullable: true },
            organization: { type: 'string', nullable: true },
            note: { type: 'string', nullable: true },
          },
        },
        CreateDamage: {
          type: 'object',
          required: ['occurredAt', 'description', 'severity'],
          properties: {
            occurredAt: { type: 'string', format: 'date-time' },
            description: { type: 'string' },
            severity: { type: 'string', enum: ['minor', 'major', 'total'] },
            photoPaths: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
    paths: {
      '/api/import': {
        post: {
          summary: 'Bulk import (generic, source-agnostic)',
          description:
            'Admin-only. Imports types, locations, assets, loans and damage ' +
            'reports in one call, cross-referenced by caller-provided keys ' +
            '(`key` for types/locations, `code` for assets). Accepts explicit ' +
            '`status`/`createdAt`/`archivedAt` and downloads any `photoUrls` ' +
            'into storage. Idempotent: re-running skips assets whose code ' +
            'already exists, and reuses types by code prefix/name and ' +
            'locations by name.',
          parameters: [
            {
              name: 'dryRun',
              in: 'query',
              schema: { type: 'boolean' },
              description: 'Validate and count only — roll everything back, write nothing.',
            },
          ],
          requestBody: jsonBody(ref('ImportPayload')),
          responses: {
            200: ok('Import summary (counts per entity)', ref('ImportResult')),
            403: ok('Caller is not an admin', ref('Error')),
          },
        },
      },
      '/api/assets': {
        get: {
          summary: 'List assets',
          parameters: [
            { name: 'q', in: 'query', schema: { type: 'string' } },
            { name: 'status', in: 'query', schema: { type: 'string' } },
            { name: 'typeId', in: 'query', schema: { type: 'string' } },
            { name: 'locationId', in: 'query', schema: { type: 'string' } },
            { name: 'includeArchived', in: 'query', schema: { type: 'boolean' } },
          ],
          responses: {
            200: ok('Matching assets', {
              type: 'object',
              properties: { items: { type: 'array', items: ref('Asset') } },
            }),
          },
        },
        post: {
          summary: 'Create an asset',
          requestBody: jsonBody(ref('CreateAsset')),
          responses: {
            201: ok('Created', {
              type: 'object',
              properties: { code: { type: 'string' }, id: { type: 'string' } },
            }),
          },
        },
      },
      '/api/assets/{code}': {
        get: {
          summary: 'Get an asset by code',
          parameters: [{ name: 'code', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            200: ok('Asset', { type: 'object', properties: { asset: ref('Asset') } }),
            404: ok('Not found', ref('Error')),
          },
        },
        patch: {
          summary: 'Update an asset',
          parameters: [{ name: 'code', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: jsonBody({ type: 'object' }),
          responses: { 200: ok('Updated') },
        },
      },
      '/api/asset-types': {
        get: { summary: 'List asset types', responses: { 200: ok('Asset types') } },
        post: {
          summary: 'Create an asset type',
          requestBody: jsonBody(ref('CreateAssetType')),
          responses: {
            201: ok('Created', { type: 'object', properties: { id: { type: 'string' } } }),
            409: ok('Code prefix already exists', ref('Error')),
          },
        },
      },
      '/api/asset-types/{id}': {
        patch: {
          summary: 'Update an asset type',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: jsonBody({ type: 'object' }),
          responses: { 200: ok('Updated'), 404: ok('Not found', ref('Error')) },
        },
        delete: {
          summary: 'Delete an asset type (must have no assets)',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: ok('Deleted'), 409: ok('Type still in use', ref('Error')) },
        },
      },
      '/api/locations': {
        get: { summary: 'List locations', responses: { 200: ok('Locations') } },
        post: {
          summary: 'Create a location',
          requestBody: jsonBody(ref('CreateLocation')),
          responses: {
            201: ok('Created', { type: 'object', properties: { id: { type: 'string' } } }),
          },
        },
      },
      '/api/locations/{id}': {
        patch: {
          summary: 'Update a location',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: jsonBody({ type: 'object' }),
          responses: { 200: ok('Updated'), 404: ok('Not found', ref('Error')) },
        },
        delete: {
          summary: 'Delete a location (must have no assets)',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: ok('Deleted'), 409: ok('Location still in use', ref('Error')) },
        },
      },
      '/api/inventory': {
        get: {
          summary: 'List inventory (stocktaking) sessions',
          responses: { 200: ok('Sessions') },
        },
        post: {
          summary: 'Open an inventory session',
          requestBody: jsonBody(ref('CreateInventorySession')),
          responses: {
            201: ok('Created', { type: 'object', properties: { id: { type: 'string' } } }),
          },
        },
      },
      '/api/inventory/{id}': {
        get: {
          summary: 'Session detail (expected vs scanned)',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: ok('Session'), 404: ok('Not found', ref('Error')) },
        },
        patch: {
          summary: 'Update a session',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: jsonBody(ref('UpdateInventorySession')),
          responses: { 200: ok('Updated') },
        },
      },
      '/api/inventory/{id}/scan': {
        post: {
          summary: 'Record a scan of an asset within the session',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: jsonBody({
            type: 'object',
            required: ['code'],
            properties: { code: { type: 'string' } },
          }),
          responses: { 200: ok('Scanned'), 404: ok('Asset/session not found', ref('Error')) },
        },
      },
      '/api/inventory/{id}/close': {
        post: {
          summary: 'Close a session',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: ok('Closed') },
        },
      },
      '/api/inventory/{id}/reopen': {
        post: {
          summary: 'Reopen a closed session',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: ok('Reopened') },
        },
      },
      '/api/damages/by-asset/{code}': {
        get: {
          summary: 'Damage reports for an asset',
          parameters: [{ name: 'code', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: ok('Reports'), 404: ok('Asset not found', ref('Error')) },
        },
        post: {
          summary: 'File a damage report against an asset',
          parameters: [{ name: 'code', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: jsonBody(ref('CreateDamage')),
          responses: {
            201: ok('Created', { type: 'object', properties: { id: { type: 'string' } } }),
            400: ok('Validation error', ref('Error')),
          },
        },
      },
      '/api/damages/{id}/resolve': {
        post: {
          summary: 'Mark a damage report resolved',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: ok('Resolved'), 404: ok('Not found', ref('Error')) },
        },
      },
      '/api/loans': {
        get: {
          summary: 'List loans (paginated)',
          parameters: [
            {
              name: 'q',
              in: 'query',
              schema: { type: 'string' },
              description: 'Borrower name contains',
            },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 100, maximum: 200 } },
            { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
          ],
          responses: {
            200: ok('Loans', {
              type: 'object',
              properties: {
                items: { type: 'array', items: ref('Loan') },
                total: { type: 'integer' },
              },
            }),
          },
        },
        post: {
          summary: 'Create a loan (immediate or planned)',
          requestBody: jsonBody(ref('CreateLoan')),
          responses: {
            201: ok('Created', { type: 'object', properties: { id: { type: 'string' } } }),
            409: ok('Asset unavailable / time conflict', ref('Error')),
          },
        },
      },
      '/api/loans/availability': {
        get: {
          summary: 'Assets available in a time window',
          parameters: [
            { name: 'from', in: 'query', schema: { type: 'string', format: 'date-time' } },
            { name: 'to', in: 'query', schema: { type: 'string', format: 'date-time' } },
            { name: 'q', in: 'query', schema: { type: 'string' } },
          ],
          responses: { 200: ok('Assets with availability flags') },
        },
      },
      '/api/loans/for-asset/{code}': {
        get: {
          summary: 'Active + planned commitments for one asset',
          parameters: [{ name: 'code', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: ok('Loan windows for the asset') },
        },
      },
      '/api/loans/calendar': {
        get: {
          summary: 'Per-asset availability for the calendar (paginated)',
          parameters: [
            {
              name: 'q',
              in: 'query',
              schema: { type: 'string' },
              description: 'Code/name contains',
            },
            {
              name: 'freeFrom',
              in: 'query',
              schema: { type: 'string', format: 'date-time' },
              description: 'Keep only assets free across the whole window [freeFrom, freeTo)',
            },
            { name: 'freeTo', in: 'query', schema: { type: 'string', format: 'date-time' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 100, maximum: 500 } },
            { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
          ],
          responses: {
            200: ok('Assets with their open windows', {
              type: 'object',
              properties: {
                items: { type: 'array', items: { type: 'object' } },
                total: { type: 'integer' },
              },
            }),
          },
        },
      },
      '/api/loans/schedule': {
        get: {
          summary: 'Live loans whose window overlaps [from, to)',
          parameters: [
            { name: 'from', in: 'query', schema: { type: 'string', format: 'date-time' } },
            { name: 'to', in: 'query', schema: { type: 'string', format: 'date-time' } },
          ],
          responses: { 200: ok('Loan start/return windows (fully returned excluded)') },
        },
      },
      '/api/loans/today': {
        get: {
          summary: 'Operational buckets: overdue, due today, starting today',
          responses: { 200: ok('Today buckets (overdue / dueToday / startingToday)') },
        },
      },
      '/feeds/loans.ics': {
        get: {
          summary: 'Subscribable iCalendar feed of loan deadlines',
          description:
            'Public calendar feed (return deadlines + planned starts) for Google/Apple ' +
            'Calendar. Authenticated with an API key passed as the `token` query parameter, ' +
            'because calendar clients fetch server-to-server and cannot send headers. The key ' +
            'must carry the `feeds` scope; create a feeds-only key so a leaked URL cannot reach ' +
            'the REST API.',
          security: [],
          parameters: [
            {
              name: 'token',
              in: 'query',
              required: true,
              schema: { type: 'string' },
              description: 'API key with the `feeds` scope',
            },
          ],
          responses: {
            200: {
              description: 'iCalendar (VCALENDAR)',
              content: { 'text/calendar': { schema: { type: 'string' } } },
            },
            401: ok('Invalid or missing token', ref('Error')),
            403: ok('Key lacks the feeds scope', ref('Error')),
          },
        },
      },
      '/api/loans/{id}': {
        get: {
          summary: 'Get a loan',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            200: ok('Loan', { type: 'object', properties: { loan: ref('Loan') } }),
            404: ok('Not found', ref('Error')),
          },
        },
        patch: {
          summary: 'Edit a loan',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: jsonBody(ref('UpdateLoan')),
          responses: { 200: ok('Updated'), 409: ok('Conflict', ref('Error')) },
        },
        delete: {
          summary: 'Cancel a planned reservation',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: ok('Cancelled'), 409: ok('Loan already started', ref('Error')) },
        },
      },
      '/api/loans/{id}/events': {
        get: {
          summary: 'Per-loan activity log',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: ok('Events newest-first') },
        },
      },
      '/api/loans/{id}/start': {
        post: {
          summary: 'Start a planned loan now',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: ok('Started'), 409: ok('Already started', ref('Error')) },
        },
      },
      '/api/loans/{id}/return-all': {
        post: {
          summary: 'Return all open items as OK',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { returnedAt: { type: 'string', format: 'date-time' } },
                },
              },
            },
          },
          responses: {
            200: ok('Returned', { type: 'object', properties: { returned: { type: 'integer' } } }),
          },
        },
      },
      '/api/loans/{id}/items': {
        post: {
          summary: 'Add assets to a loan',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: jsonBody(ref('AddLoanItems')),
          responses: { 200: ok('Added'), 409: ok('Conflict / unavailable', ref('Error')) },
        },
      },
      '/api/loans/{id}/items/{itemId}': {
        delete: {
          summary: 'Remove an open item from a loan',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'itemId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: { 200: ok('Removed'), 409: ok('Returned/last item', ref('Error')) },
        },
      },
      '/api/loans/{id}/items/{itemId}/return': {
        post: {
          summary: 'Return one item',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'itemId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          requestBody: jsonBody(ref('ReturnLoanItem')),
          responses: { 200: ok('Returned'), 400: ok('Bad date', ref('Error')) },
        },
      },
      '/api/contacts': {
        get: { summary: 'List contacts', responses: { 200: ok('Contacts') } },
        post: {
          summary: 'Create a contact (external borrower)',
          requestBody: jsonBody(ref('CreateContact')),
          responses: {
            201: ok('Created', { type: 'object', properties: { id: { type: 'string' } } }),
          },
        },
      },
      '/api/contacts/{id}': {
        get: {
          summary: 'Get a contact',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: ok('Contact'), 404: ok('Not found', ref('Error')) },
        },
        patch: {
          summary: 'Update a contact',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: jsonBody({ type: 'object' }),
          responses: { 200: ok('Updated') },
        },
        delete: {
          summary: 'Delete a contact',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: ok('Deleted') },
        },
      },
      '/api/users': {
        get: { summary: 'List users', responses: { 200: ok('Users') } },
      },
      '/api/users/{id}': {
        patch: {
          summary: 'Update a user (role / disabled state) — admin',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: jsonBody({ type: 'object' }),
          responses: { 200: ok('Updated'), 403: ok('Not an admin', ref('Error')) },
        },
      },
      '/api/org': {
        get: { summary: 'Organization settings', responses: { 200: ok('Org settings') } },
      },
      '/api/uploads': {
        post: {
          summary: 'Upload an image/PDF (multipart) → returns a stored path',
          requestBody: {
            required: true,
            content: {
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  properties: { file: { type: 'string', format: 'binary' } },
                },
              },
            },
          },
          responses: {
            200: ok('Stored', {
              type: 'object',
              properties: {
                path: { type: 'string' },
                url: { type: 'string' },
                size: { type: 'integer' },
                contentType: { type: 'string' },
              },
            }),
            413: ok('Too large / unsupported type', ref('Error')),
          },
        },
      },
      '/api/export/assets.csv': {
        get: { summary: 'Export all assets as CSV', responses: { 200: ok('CSV file') } },
      },
      '/api/export/loans.csv': {
        get: { summary: 'Export all loans as CSV', responses: { 200: ok('CSV file') } },
      },
      '/api/export/damages.csv': {
        get: { summary: 'Export all damage reports as CSV', responses: { 200: ok('CSV file') } },
      },
      '/api/export/contacts.csv': {
        get: { summary: 'Export all contacts as CSV', responses: { 200: ok('CSV file') } },
      },
      '/api/export/full.json': {
        get: {
          summary: 'Full data dump in the import format (admin)',
          description:
            'Everything (types, locations, assets, loans, damages) in the exact ' +
            'shape `POST /api/import` accepts — for hub→hub migration, backup ' +
            'and round-trip. Media is referenced by `photoPaths`; copy the ' +
            'upload directory alongside the JSON when restoring elsewhere.',
          responses: {
            200: ok('Import-shaped dump', ref('ImportPayload')),
            403: ok('Caller is not an admin', ref('Error')),
          },
        },
      },
      '/api/api-keys': {
        get: { summary: 'List API keys (admin)', responses: { 200: ok('Keys (no token)') } },
        post: {
          summary: 'Create an API key (admin) — token returned once',
          requestBody: jsonBody(ref('CreateApiKey')),
          responses: {
            201: ok('Created', {
              type: 'object',
              properties: {
                id: { type: 'string' },
                token: { type: 'string' },
                prefix: { type: 'string' },
                scopes: { type: 'array', items: { type: 'string', enum: ['api', 'feeds'] } },
              },
            }),
          },
        },
      },
      '/api/api-keys/{id}': {
        delete: {
          summary: 'Revoke an API key (admin)',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: ok('Revoked'), 404: ok('Not found', ref('Error')) },
        },
      },
    },
  };
}

/** Self-hosted Swagger UI page (assets served from {@link SWAGGER_UI_DIR}). */
export const DOCS_HTML = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Inventory Hub API</title>
    <link rel="stylesheet" href="/docs/swagger-ui.css" />
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="/docs/swagger-ui-bundle.js"></script>
    <script src="/docs/swagger-ui-standalone-preset.js"></script>
    <script>
      window.ui = SwaggerUIBundle({
        url: '/openapi.json',
        dom_id: '#swagger-ui',
        presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
        layout: 'StandaloneLayout',
      });
    </script>
  </body>
</html>`;

/** Content types for the Swagger UI static files we serve under /docs/. */
export const SWAGGER_UI_FILES: Record<string, string> = {
  'swagger-ui.css': 'text/css; charset=utf-8',
  'swagger-ui-bundle.js': 'application/javascript; charset=utf-8',
  'swagger-ui-standalone-preset.js': 'application/javascript; charset=utf-8',
};
