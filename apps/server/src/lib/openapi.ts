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
      },
    },
    paths: {
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
      '/api/loans': {
        get: {
          summary: 'List loans (paginated)',
          parameters: [
            { name: 'q', in: 'query', schema: { type: 'string' }, description: 'Borrower name contains' },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 100, maximum: 200 } },
            { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
          ],
          responses: {
            200: ok('Loans', {
              type: 'object',
              properties: { items: { type: 'array', items: ref('Loan') }, total: { type: 'integer' } },
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
            { name: 'q', in: 'query', schema: { type: 'string' }, description: 'Code/name contains' },
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
            'because calendar clients fetch server-to-server and cannot send headers.',
          security: [],
          parameters: [
            {
              name: 'token',
              in: 'query',
              required: true,
              schema: { type: 'string' },
              description: 'API key',
            },
          ],
          responses: {
            200: {
              description: 'iCalendar (VCALENDAR)',
              content: { 'text/calendar': { schema: { type: 'string' } } },
            },
            401: ok('Invalid or missing token', ref('Error')),
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
                schema: { type: 'object', properties: { returnedAt: { type: 'string', format: 'date-time' } } },
              },
            },
          },
          responses: { 200: ok('Returned', { type: 'object', properties: { returned: { type: 'integer' } } }) },
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
      },
      '/api/api-keys': {
        get: { summary: 'List API keys (admin)', responses: { 200: ok('Keys (no token)') } },
        post: {
          summary: 'Create an API key (admin) — token returned once',
          requestBody: jsonBody(ref('CreateApiKey')),
          responses: {
            201: ok('Created', {
              type: 'object',
              properties: { id: { type: 'string' }, token: { type: 'string' }, prefix: { type: 'string' } },
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
