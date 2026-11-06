import { isOpenApiDocument, readOpenApi } from './openapi-import.util';
import { parseUntrustedJson } from './safe-json.util';

const v3 = {
  openapi: '3.0.3',
  info: { title: 'Pet Store', description: 'Pets' },
  servers: [{ url: 'https://{env}.pets.test/v1', variables: { env: { default: 'api' } } }],
  security: [{ bearerAuth: [] }],
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' }, keyAuth: { type: 'apiKey', in: 'header', name: 'X-Key' }, oauth: { type: 'oauth2' } },
    schemas: {
      Pet: { type: 'object', required: ['name'], properties: { id: { type: 'integer' }, name: { type: 'string', example: 'Rex' }, born: { type: 'string', format: 'date' }, owner: { $ref: '#/components/schemas/Owner' } } },
      Owner: { type: 'object', properties: { pets: { type: 'array', items: { $ref: '#/components/schemas/Pet' } }, email: { type: 'string', format: 'email' } } },
    },
  },
  paths: {
    '/pets': {
      parameters: [{ name: 'X-Request-Id', in: 'header', schema: { type: 'string' } }],
      get: { tags: ['pets'], summary: 'List pets', parameters: [{ name: 'limit', in: 'query', required: true, schema: { type: 'integer', default: 20 } }, { name: 'tag', in: 'query', schema: { type: 'string' } }] },
      post: { tags: ['pets'], operationId: 'createPet', requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } } } },
    },
    '/pets/{petId}': {
      get: { summary: 'Get a pet', parameters: [{ name: 'petId', in: 'path', required: true, schema: { type: 'string' } }], security: [{ keyAuth: [] }] },
      delete: { tags: ['admin'], security: [{ oauth: [] }] },
      trace: {},
    },
    '/upload': {
      post: { requestBody: { content: { 'multipart/form-data': { schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' }, note: { type: 'string' } } } } } } },
    },
    '/login': {
      post: { requestBody: { content: { 'application/x-www-form-urlencoded': { schema: { type: 'object', properties: { user: { type: 'string' } } } } } } },
    },
  },
};

describe('OpenAPI import (3.x)', () => {
  const bundle = readOpenApi(v3);
  const find = (name: string) => bundle.requests.find((r) => r.name === name)!;

  it('detects OpenAPI and Swagger documents', () => {
    expect(isOpenApiDocument(v3)).toBe(true);
    expect(isOpenApiDocument({ swagger: '2.0' })).toBe(true);
    expect(isOpenApiDocument({ info: {}, item: [] })).toBe(false);
  });

  it('creates one collection, one folder per tag and one request per operation', () => {
    expect(bundle.collections.map((c) => [c.name, c.description])).toEqual([['Pet Store', 'Pets']]);
    expect(bundle.folders.map((f) => f.name)).toEqual(['pets', 'admin']);
    expect(bundle.requests).toHaveLength(6);
    expect(find('List pets').folderId).toBe(bundle.folders[0].id);
    expect(find('Get a pet').folderId).toBeNull();
  });

  it('names requests from summary, operationId or method and path', () => {
    expect(bundle.requests.map((r) => r.name).sort()).toEqual(
      ['DELETE /pets/{petId}', 'Get a pet', 'List pets', 'POST /login', 'POST /upload', 'createPet'].sort(),
    );
  });

  it('puts the server in a baseUrl variable (with server variable defaults) used by every URL', () => {
    expect(bundle.environments).toHaveLength(1);
    expect(bundle.environments[0].variables.find((v) => v.name === 'baseUrl')?.value).toBe('https://api.pets.test/v1');
    expect(bundle.requests.every((r) => r.definition.url.startsWith('{{baseUrl}}/'))).toBe(true);
  });

  it('turns path parameters into variables and required query params into enabled ones', () => {
    expect(find('Get a pet').definition.url).toBe('{{baseUrl}}/pets/{{petId}}');
    const list = find('List pets').definition;
    expect(list.url).toBe('{{baseUrl}}/pets?limit=20');
    expect(list.params.map((p) => [p.key, p.value, p.enabled])).toEqual([['limit', '20', true], ['tag', '', false]]);
    expect(list.headers.map((h) => [h.key, h.enabled])).toEqual([['X-Request-Id', false]]);
  });

  it('generates a JSON body from the schema, following references without looping', () => {
    const body = find('createPet').definition.body;
    expect(body.type).toBe('text');
    const parsed = JSON.parse((body as { content: string }).content);
    expect(parsed).toMatchObject({ id: 0, name: 'Rex', born: '2024-01-01' });
    expect(parsed.owner.email).toBe('user@example.com');
  });

  it('builds urlencoded and multipart bodies from schema properties', () => {
    expect(find('POST /login').definition.body).toMatchObject({ type: 'urlencoded', fields: [{ key: 'user' }] });
    expect(find('POST /upload').definition.body).toMatchObject({
      type: 'multipart',
      fields: [{ key: 'file', kind: 'file' }, { key: 'note', kind: 'text' }],
    });
  });

  it('never gives GET or HEAD a body', () => {
    expect(find('List pets').definition.body).toEqual({ type: 'none' });
  });

  it('maps security schemes to auth with variables, and secrets are marked secret', () => {
    expect(find('List pets').definition.auth).toEqual({ type: 'bearer', token: '{{token}}' });
    expect(find('Get a pet').definition.auth).toEqual({ type: 'apiKey', key: 'X-Key', value: '{{apiKey}}', placement: 'header' });
    const vars = Object.fromEntries(bundle.environments[0].variables.map((v) => [v.name, v]));
    expect(vars['token']).toMatchObject({ secret: true, value: '' });
    expect(vars['apiKey']).toMatchObject({ secret: true, value: '' });
  });

  it('reports unsupported auth (OAuth) and TRACE operations', () => {
    expect(find('DELETE /pets/{petId}').definition.auth).toEqual({ type: 'none' });
    const text = bundle.warnings.join(' ');
    expect(text).toMatch(/Only the OAuth 2.0 Authorization Code flow/);
    expect(text).toMatch(/TRACE/);
    expect(text).toMatch(/generated from the schemas/);
  });
});

describe('OpenAPI import (OAuth 2.0)', () => {
  const doc = (scheme: unknown) => ({
    openapi: '3.0.0', info: { title: 'x' },
    components: { securitySchemes: { oauth: scheme } },
    paths: { '/a': { get: { security: [{ oauth: ['read', 'write'] }] } } },
  });

  it('maps an authorizationCode flow to OAuth settings with a clientId variable', () => {
    const bundle = readOpenApi(doc({ type: 'oauth2', flows: { authorizationCode: { authorizationUrl: 'https://id.test/auth', tokenUrl: 'https://id.test/token', scopes: {} } } }));
    expect(bundle.requests[0].definition.auth).toEqual({
      type: 'oauth2', authorizationUrl: 'https://id.test/auth', tokenUrl: 'https://id.test/token', clientId: '{{clientId}}', scope: 'read write',
    });
    expect(bundle.environments[0].variables.find((v) => v.name === 'clientId')).toMatchObject({ secret: false });
  });

  it('does not import flows that need a client secret or are insecure (implicit, password, client credentials)', () => {
    for (const flows of [{ implicit: { authorizationUrl: 'https://id.test/a', scopes: {} } }, { password: { tokenUrl: 'https://id.test/t', scopes: {} } }, { clientCredentials: { tokenUrl: 'https://id.test/t', scopes: {} } }]) {
      const bundle = readOpenApi(doc({ type: 'oauth2', flows }));
      expect(bundle.requests[0].definition.auth).toEqual({ type: 'none' });
      expect(bundle.warnings.join(' ')).toMatch(/Only the OAuth 2.0 Authorization Code flow/);
    }
  });

  it('maps a Swagger 2.0 accessCode flow', () => {
    const bundle = readOpenApi({
      swagger: '2.0', info: { title: 'x' }, host: 'h.test',
      securityDefinitions: { oauth: { type: 'oauth2', flow: 'accessCode', authorizationUrl: 'https://id.test/a', tokenUrl: 'https://id.test/t' } },
      paths: { '/a': { get: { security: [{ oauth: [] }] } } },
    });
    expect(bundle.requests[0].definition.auth).toMatchObject({ type: 'oauth2', tokenUrl: 'https://id.test/t' });
  });
});

describe('OpenAPI import (Swagger 2.0)', () => {
  const doc = {
    swagger: '2.0', info: { title: 'Old' }, host: 'old.test', basePath: '/api', schemes: ['https'],
    securityDefinitions: { basic: { type: 'basic' } },
    paths: {
      '/items': {
        post: {
          consumes: ['application/json'], security: [{ basic: [] }],
          parameters: [{ in: 'body', name: 'body', schema: { type: 'object', properties: { n: { type: 'integer' } } } }],
        },
        put: { parameters: [{ in: 'formData', name: 'f', type: 'file' }, { in: 'formData', name: 't', type: 'string' }] },
      },
    },
  };

  it('uses host, basePath and scheme, and reads body and form parameters', () => {
    const bundle = readOpenApi(doc);
    expect(bundle.environments[0].variables.find((v) => v.name === 'baseUrl')?.value).toBe('https://old.test/api');
    const post = bundle.requests.find((r) => r.definition.method === 'POST')!.definition;
    expect(post.body).toMatchObject({ type: 'text', language: 'json' });
    expect(JSON.parse((post.body as { content: string }).content)).toEqual({ n: 0 });
    expect(post.auth).toEqual({ type: 'basic', username: '{{username}}', password: '{{password}}' });
    const put = bundle.requests.find((r) => r.definition.method === 'PUT')!.definition;
    expect(put.body).toMatchObject({ type: 'multipart', fields: [{ key: 'f', kind: 'file' }, { key: 't', kind: 'text' }] });
  });
});

describe('OpenAPI import safety', () => {
  it('never follows external references and says so', () => {
    const bundle = readOpenApi({
      openapi: '3.0.0', info: { title: 'x' },
      paths: { '/a': { post: { requestBody: { content: { 'application/json': { schema: { $ref: 'https://evil.test/schema.json' } } } } } } },
    });
    expect(bundle.warnings.join(' ')).toMatch(/not followed/);
  });

  it('survives circular $ref chains and self-referencing schemas', () => {
    const bundle = readOpenApi({
      openapi: '3.0.0', info: { title: 'x' },
      components: { schemas: { A: { $ref: '#/components/schemas/B' }, B: { $ref: '#/components/schemas/A' }, Node: { type: 'object', properties: { next: { $ref: '#/components/schemas/Node' } } } } },
      paths: {
        '/loop': { post: { requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/A' } } } } } },
        '/tree': { post: { requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Node' } } } } } },
      },
    });
    expect(bundle.requests).toHaveLength(2);
    expect(bundle.warnings.join(' ')).toMatch(/too long|circular/);
  });

  it('bounds the size of generated examples', () => {
    const wide = { type: 'object', properties: Object.fromEntries(Array.from({ length: 5000 }, (_, i) => [`p${i}`, { type: 'string' }])) };
    const bundle = readOpenApi({ openapi: '3.0.0', info: { title: 'x' }, paths: { '/w': { post: { requestBody: { content: { 'application/json': { schema: wide } } } } } } });
    const body = bundle.requests[0].definition.body as { content: string };
    expect(Object.keys(JSON.parse(body.content)).length).toBeLessThanOrEqual(5000);
    expect(body.content.length).toBeLessThan(200_000);
  });

  it('cannot be used to pollute prototypes through schema property names', () => {
    // The raw text is rejected by the parser before it ever reaches the converter.
    const text = '{"openapi":"3.0.0","info":{"title":"x"},"paths":{"/a":{"post":{"requestBody":{"content":{"application/json":{"schema":{"properties":{"__proto__":{"type":"string"}}}}}}}}}}';
    expect(() => readOpenApi(parseUntrustedJson(text))).toThrow(/forbidden key/);
    expect(({} as Record<string, unknown>)['type']).toBeUndefined();
  });

  it('rejects unsupported versions and other documents', () => {
    expect(() => readOpenApi({ openapi: '4.0.0' })).toThrow(/not supported/);
    expect(() => readOpenApi({ item: [] })).toThrow(/not an OpenAPI/);
  });

  it('notes an empty description', () => {
    expect(readOpenApi({ openapi: '3.0.0', info: { title: 'x' }, paths: {} }).warnings.join(' ')).toMatch(/no operations/);
  });
});
