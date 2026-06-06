/**
 * Hand-authored OpenAPI 3.1 description of the integration-facing REST API.
 *
 * It is curated (the main resources integrators use), not auto-derived from
 * every route — keep it in sync when those endpoints change. Served at
 * `/openapi.json`; `/docs` renders it with Scalar.
 */

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
    openapi: '3.1.0',
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
        Asset: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            code: { type: 'string' },
            name: { type: 'string' },
            status: {
              type: 'string',
              enum: ['in_stock', 'assigned', 'on_loan', 'in_repair', 'damaged', 'sold', 'lost', 'retired'],
            },
            typeId: { type: ['string', 'null'] },
            locationId: { type: ['string', 'null'] },
            archivedAt: { type: ['string', 'null'], format: 'date-time' },
          },
        },
        CreateAsset: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string' },
            code: { type: 'string', description: 'Optional; auto-generated from the type prefix if omitted.' },
            typeId: { type: ['string', 'null'] },
            locationId: { type: ['string', 'null'] },
            notes: { type: ['string', 'null'] },
          },
        },
        Loan: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            borrowerName: { type: 'string' },
            borrowerContact: { type: ['string', 'null'] },
            purpose: { type: ['string', 'null'] },
            loanedAt: { type: 'string', format: 'date-time' },
            startedAt: { type: ['string', 'null'], format: 'date-time' },
            expectedReturnAt: { type: ['string', 'null'], format: 'date-time' },
            status: { type: 'string', enum: ['planned', 'open', 'partially_returned', 'fully_returned'] },
            items: { type: 'array', items: { type: 'object' } },
          },
        },
        CreateLoan: {
          type: 'object',
          required: ['borrowerName', 'assetCodes'],
          properties: {
            borrowerName: { type: 'string' },
            borrowerContact: { type: ['string', 'null'] },
            purpose: { type: ['string', 'null'] },
            loanedAt: {
              type: ['string', 'null'],
              format: 'date-time',
              description: 'Future value => planned loan (assets reserved until it starts).',
            },
            expectedReturnAt: { type: ['string', 'null'], format: 'date-time' },
            assetCodes: { type: 'array', items: { type: 'string' }, minItems: 1 },
          },
        },
        UpdateLoan: {
          type: 'object',
          properties: {
            borrowerName: { type: 'string' },
            borrowerContact: { type: ['string', 'null'] },
            purpose: { type: ['string', 'null'] },
            loanedAt: { type: 'string', format: 'date-time', description: 'Only for planned loans.' },
            expectedReturnAt: { type: ['string', 'null'], format: 'date-time' },
          },
        },
        AddLoanItems: {
          type: 'object',
          required: ['assetCodes'],
          properties: { assetCodes: { type: 'array', items: { type: 'string' }, minItems: 1 } },
        },
        ReturnLoanItem: {
          type: 'object',
          required: ['returnCondition'],
          properties: {
            returnCondition: { type: 'string', enum: ['ok', 'damaged'] },
            returnNotes: { type: ['string', 'null'] },
            returnedAt: { type: 'string', format: 'date-time', description: 'Optional backdate; defaults to now.' },
          },
        },
        CreateApiKey: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string' },
            expiresAt: { type: ['string', 'null'], format: 'date-time' },
          },
        },
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
          responses: { 201: ok('Created', { type: 'object', properties: { code: { type: 'string' }, id: { type: 'string' } } }) },
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
      '/api/loans/{id}': {
        get: {
          summary: 'Get a loan',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: ok('Loan', { type: 'object', properties: { loan: ref('Loan') } }), 404: ok('Not found', ref('Error')) },
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
          requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { returnedAt: { type: 'string', format: 'date-time' } } } } } },
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
          responses: { 201: ok('Created', { type: 'object', properties: { id: { type: 'string' }, token: { type: 'string' }, prefix: { type: 'string' } } }) },
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

export const DOCS_HTML = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Inventory Hub API</title>
  </head>
  <body>
    <script id="api-reference" data-url="/openapi.json"></script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </body>
</html>`;
