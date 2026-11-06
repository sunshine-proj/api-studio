import { SavedRequest, SCHEMA_VERSION } from '../models';
import { createEmptyRequest } from '../utils/request-factory';
import { ExportSource } from './native-format.util';
import { buildPostmanExport, isPostmanCollection, readPostmanCollection } from './postman-format.util';
import { parseUntrustedJson } from './safe-json.util';

const stamp = { schemaVersion: SCHEMA_VERSION, createdAt: 1, updatedAt: 1 };

const postman = {
  info: { name: 'Shop', description: 'A shop', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
  auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{token}}', type: 'string' }] },
  variable: [{ key: 'baseUrl', value: 'https://shop.test' }, { key: '', value: 'ignored' }],
  event: [{ listen: 'prerequest', script: { exec: ['pm.environment.set("a", 1)'] } }],
  item: [
    {
      name: 'Users',
      item: [
        {
          name: 'Create user',
          event: [{ listen: 'test', script: { exec: ['pm.test()'] } }],
          request: {
            method: 'post',
            header: [{ key: 'X-Trace', value: '1' }, { key: 'X-Off', value: '2', disabled: true }],
            url: { raw: '{{baseUrl}}/users?active=true', query: [{ key: 'active', value: 'true' }, { key: 'debug', value: '1', disabled: true }] },
            body: { mode: 'raw', raw: '{"name":"Ann"}', options: { raw: { language: 'json' } } },
          },
        },
        { name: 'Login', request: { method: 'POST', url: '{{baseUrl}}/login', auth: { type: 'basic', basic: [{ key: 'username', value: 'ann' }, { key: 'password', value: 'pw' }] }, body: { mode: 'urlencoded', urlencoded: [{ key: 'a', value: 'b' }] } } },
        { name: 'Public', request: { method: 'GET', url: '{{baseUrl}}/public', auth: { type: 'noauth' } } },
      ],
    },
    { name: 'Upload', request: { method: 'POST', url: 'https://shop.test/up', body: { mode: 'formdata', formdata: [{ key: 'note', type: 'text', value: 'hi' }, { key: 'doc', type: 'file', src: '/home/ann/report.pdf' }] } } },
    { name: 'GraphQL', request: { method: 'POST', url: 'https://shop.test/graphql', body: { mode: 'graphql', graphql: { query: '{ a }' } } } },
    { name: 'Weird auth', request: { method: 'GET', url: 'https://shop.test/w', auth: { type: 'oauth2' } } },
    { name: 'String request', request: 'https://shop.test/plain' },
  ],
};

describe('Postman import', () => {
  const bundle = readPostmanCollection(postman);
  const byName = (name: string): SavedRequest => bundle.requests.find((r) => r.name === name)!;

  it('detects Postman collections', () => {
    expect(isPostmanCollection(postman)).toBe(true);
    expect(isPostmanCollection({ openapi: '3.0.0' })).toBe(false);
    expect(isPostmanCollection(null)).toBe(false);
  });

  it('builds the folder hierarchy and the requests in it', () => {
    expect(bundle.collections.map((c) => [c.name, c.description])).toEqual([['Shop', 'A shop']]);
    expect(bundle.folders.map((f) => f.name)).toEqual(['Users']);
    expect(byName('Create user').folderId).toBe(bundle.folders[0].id);
    expect(byName('Upload').folderId).toBeNull();
    expect(bundle.requests).toHaveLength(7); // every item with a request, including the nested ones
  });

  it('converts method, url, params, headers and a JSON body', () => {
    const d = byName('Create user').definition;
    expect(d.method).toBe('POST');
    expect(d.url).toBe('{{baseUrl}}/users?active=true');
    expect(d.params.map((p) => [p.key, p.value, p.enabled])).toEqual([['active', 'true', true], ['debug', '1', false]]);
    expect(d.headers.map((h) => [h.key, h.enabled])).toEqual([['X-Trace', true], ['X-Off', false]]);
    expect(d.body).toEqual({ type: 'text', language: 'json', content: '{"name":"Ann"}' });
  });

  it('applies inherited auth, lets requests override it, and honours "No Auth"', () => {
    expect(byName('Create user').definition.auth).toEqual({ type: 'bearer', token: '{{token}}' });
    expect(byName('Login').definition.auth).toEqual({ type: 'basic', username: 'ann', password: 'pw' });
    expect(byName('Public').definition.auth).toEqual({ type: 'none' });
  });

  it('converts urlencoded and multipart bodies, keeping only file names', () => {
    expect(byName('Login').definition.body).toMatchObject({ type: 'urlencoded', fields: [{ key: 'a', value: 'b' }] });
    const form = byName('Upload').definition.body;
    expect(form).toMatchObject({ type: 'multipart', fields: [{ key: 'note', kind: 'text' }, { key: 'doc', kind: 'file', file: { name: 'report.pdf', size: 0 } }] });
    expect(JSON.stringify(form)).not.toContain('/home/ann');
  });

  it('never imports scripts and says how many were skipped', () => {
    expect(JSON.stringify(bundle)).not.toMatch(/pm\.|prerequest/);
    expect(bundle.warnings.join(' ')).toMatch(/2 pre-request\/test scripts were not imported/);
    const single = readPostmanCollection({ info: { name: 'x' }, event: [{ listen: 'test' }], item: [] });
    expect(single.warnings.join(' ')).toMatch(/1 pre-request\/test script was not imported/);
  });

  it('reports unsupported auth and body types instead of dropping them silently', () => {
    expect(byName('Weird auth').definition.auth).toEqual({ type: 'none' });
    expect(bundle.warnings.join(' ')).toMatch(/oauth2/);
    const unknown = readPostmanCollection({ info: { name: 'x' }, item: [{ name: 'r', request: { method: 'POST', url: 'https://a.test', body: { mode: 'mystery' } } }] });
    expect(unknown.requests[0].definition.body).toEqual({ type: 'none' });
    expect(unknown.warnings.join(' ')).toMatch(/"mystery" are not supported/);
  });

  it('imports GraphQL bodies', () => {
    expect(byName('GraphQL').definition.body).toEqual({ type: 'graphql', query: '{ a }', variables: '', operationName: '' });
  });

  it('turns collection variables into an environment', () => {
    expect(bundle.environments).toHaveLength(1);
    expect(bundle.environments[0].variables).toMatchObject([{ name: 'baseUrl', value: 'https://shop.test', secret: false }]);
  });

  it('accepts a request given as a plain URL string', () => {
    expect(byName('String request').definition).toMatchObject({ method: 'GET', url: 'https://shop.test/plain' });
  });

  it('guesses the body language from the Content-Type header when none is declared', () => {
    const b = readPostmanCollection({
      info: { name: 'x' },
      item: [{ name: 'r', request: { method: 'POST', url: 'https://a.test', header: [{ key: 'Content-Type', value: 'application/json' }], body: { mode: 'raw', raw: '{}' } } }],
    });
    expect(b.requests[0].definition.body).toMatchObject({ language: 'json' });
  });

  it('rejects other documents', () => {
    expect(() => readPostmanCollection({ openapi: '3.0.0' })).toThrow(/not a Postman collection/);
  });
});

describe('Postman export', () => {
  const source: ExportSource = {
    collections: [{ id: 'c', ...stamp, name: 'API', description: 'd', sortOrder: 0 }],
    folders: [{ id: 'f', ...stamp, name: 'Folder', collectionId: 'c', parentId: null, sortOrder: 0 }],
    requests: [
      {
        id: 'r1', ...stamp, name: 'In folder', collectionId: 'c', folderId: 'f', sortOrder: 0,
        definition: {
          ...createEmptyRequest(), method: 'POST', url: 'https://a.test/x?a=1',
          params: [{ id: '1', key: 'a', value: '1', enabled: true }, { id: '2', key: 'off', value: 'z', enabled: false }],
          headers: [{ id: '3', key: 'X-A', value: 'b', enabled: true }],
          auth: { type: 'bearer', token: 'literal-token' },
          body: { type: 'text', language: 'json', content: '{"k":1}' },
        },
      },
      { id: 'r2', ...stamp, name: 'Root', collectionId: 'c', folderId: null, sortOrder: 0, definition: { ...createEmptyRequest(), url: 'https://a.test/r' } },
    ],
    environments: [],
  };

  it('produces a Postman v2.1 document with folders and requests', () => {
    const doc = JSON.parse(buildPostmanExport(source, 'c', { includeSecrets: true }));
    expect(doc.info.schema).toContain('v2.1.0');
    expect(doc.item.map((i: { name: string }) => i.name)).toEqual(['Folder', 'Root']);
    expect(doc.item[0].item[0].request.auth).toEqual({ type: 'bearer', bearer: [{ key: 'token', value: 'literal-token', type: 'string' }] });
  });

  it('leaves credentials out by default', () => {
    expect(buildPostmanExport(source, 'c', { includeSecrets: false })).not.toContain('literal-token');
  });

  it('round-trips through the importer', () => {
    const text = buildPostmanExport(source, 'c', { includeSecrets: true });
    const bundle = readPostmanCollection(parseUntrustedJson(text));
    const original = source.requests[0].definition;
    const back = bundle.requests.find((r) => r.name === 'In folder')!.definition;
    expect(back.method).toBe(original.method);
    expect(back.url).toBe(original.url);
    expect(back.params.map((p) => [p.key, p.value, p.enabled])).toEqual([['a', '1', true], ['off', 'z', false]]);
    expect(back.headers.map((h) => [h.key, h.value])).toEqual([['X-A', 'b']]);
    expect(back.auth).toEqual(original.auth);
    expect(back.body).toEqual(original.body);
    expect(bundle.folders.map((f) => f.name)).toEqual(['Folder']);
  });

  it('exports custom-header auth as a header and multipart files by name only', () => {
    const custom: ExportSource = {
      ...source,
      requests: [{
        ...source.requests[0],
        definition: {
          ...createEmptyRequest(), method: 'POST', url: 'https://a.test',
          auth: { type: 'custom', headerName: 'X-Auth', headerValue: 'v' },
          body: { type: 'multipart', fields: [{ id: '1', key: 'doc', kind: 'file', value: '', enabled: true, file: { name: 'a.pdf', size: 9, mimeType: '' } }] },
        },
      }],
    };
    const doc = JSON.parse(buildPostmanExport(custom, 'c', { includeSecrets: true }));
    const request = doc.item[0].item[0].request;
    expect(request.header).toContainEqual({ key: 'X-Auth', value: 'v' });
    expect(request.body.formdata).toEqual([{ key: 'doc', type: 'file', src: 'a.pdf' }]);
  });

  it('refuses an unknown collection', () => {
    expect(() => buildPostmanExport(source, 'missing', { includeSecrets: false })).toThrow(/no longer exists/);
  });
});
