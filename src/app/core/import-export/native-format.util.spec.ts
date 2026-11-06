import { Environment, SavedRequest, SCHEMA_VERSION } from '../models';
import { createEmptyRequest } from '../utils/request-factory';
import { ExportSource, buildNativeExport, readNativeExport, withoutSecrets } from './native-format.util';
import { parseUntrustedJson } from './safe-json.util';

const stamp = { schemaVersion: SCHEMA_VERSION, createdAt: 1, updatedAt: 1 };
const kv = (key: string, value: string) => ({ id: key, key, value, enabled: true });

function request(id: string, over: Partial<SavedRequest> = {}): SavedRequest {
  return {
    id, ...stamp, name: `Request ${id}`, collectionId: 'c1', folderId: null, sortOrder: 0,
    definition: { ...createEmptyRequest(), method: 'POST', url: 'https://a.test/x' },
    ...over,
  };
}

const environment: Environment = {
  id: 'e1', ...stamp, name: 'Prod',
  variables: [
    { id: 'v1', name: 'host', value: 'a.test', enabled: true, secret: false },
    { id: 'v2', name: 'token', value: 'tok-secret-1', enabled: true, secret: true },
  ],
};

const source: ExportSource = {
  collections: [{ id: 'c1', ...stamp, name: 'API', description: 'desc', sortOrder: 0 }],
  folders: [
    { id: 'f1', ...stamp, name: 'v1', collectionId: 'c1', parentId: null, sortOrder: 0 },
    { id: 'f2', ...stamp, name: 'orders', collectionId: 'c1', parentId: 'f1', sortOrder: 0 },
  ],
  requests: [
    request('r1'),
    request('r2', {
      folderId: 'f2',
      definition: {
        ...createEmptyRequest(), method: 'GET', url: 'https://a.test/orders?key=tok-secret-1',
        headers: [kv('Authorization', 'Bearer literal-token')],
        auth: { type: 'bearer', token: 'literal-token' },
        body: { type: 'text', language: 'json', content: '{"a":1}' },
      },
    }),
  ],
  environments: [environment],
};

const roundTrip = (text: string) => readNativeExport(parseUntrustedJson(text));

describe('native export and import', () => {
  it('round-trips collections, nested folders, requests and environments with fresh ids', () => {
    const bundle = roundTrip(buildNativeExport(source, { includeSecrets: true }));
    expect(bundle.collections.map((c) => [c.name, c.description])).toEqual([['API', 'desc']]);
    expect(bundle.collections[0].id).not.toBe('c1');
    const [v1, orders] = [...bundle.folders].sort((a, b) => a.name.localeCompare(b.name)).reverse();
    expect(orders.parentId).toBe(v1.id);
    expect(bundle.requests).toHaveLength(2);
    expect(bundle.requests.find((r) => r.name === 'Request r2')?.folderId).toBe(orders.id);
    expect(bundle.requests.every((r) => r.collectionId === bundle.collections[0].id)).toBe(true);
    expect(bundle.environments[0].variables.map((v) => v.name)).toEqual(['host', 'token']);
    expect(bundle.warnings).toEqual([]);
  });

  it('keeps definitions intact when secrets are included', () => {
    const bundle = roundTrip(buildNativeExport(source, { includeSecrets: true }));
    const r2 = bundle.requests.find((r) => r.name === 'Request r2')!;
    expect(r2.definition.auth).toEqual({ type: 'bearer', token: 'literal-token' });
    expect(r2.definition.body).toEqual({ type: 'text', language: 'json', content: '{"a":1}' });
    expect(bundle.environments[0].variables[1].value).toBe('tok-secret-1');
  });

  it('leaves credentials and secret values out by default', () => {
    const text = buildNativeExport(source, { includeSecrets: false });
    expect(text).not.toMatch(/literal-token|tok-secret-1/);
    const bundle = roundTrip(text);
    const r2 = bundle.requests.find((r) => r.name === 'Request r2')!;
    expect(r2.definition.auth).toEqual({ type: 'bearer', token: '' });
    expect(r2.definition.url).toBe('https://a.test/orders?key={{token}}');
    expect(bundle.environments[0].variables[1]).toMatchObject({ name: 'token', value: '', secret: true });
    expect(bundle.warnings.join(' ')).toMatch(/without credentials/);
  });

  it('scrubs secrets of environments that are not part of the export', () => {
    const withoutEnvironments: ExportSource = { ...source, environments: [], secrets: [{ name: 'token', value: 'tok-secret-1' }] };
    const text = buildNativeExport(withoutEnvironments, { includeSecrets: false });
    expect(text).not.toContain('tok-secret-1');
    expect(text).toContain('key={{token}}');
  });

  it('does not modify its source', () => {
    const snapshot = JSON.stringify(source);
    withoutSecrets(source);
    buildNativeExport(source, { includeSecrets: false });
    expect(JSON.stringify(source)).toBe(snapshot);
  });

  it('refuses anything that is not an API Studio export', () => {
    expect(() => readNativeExport({})).toThrow(/not an API Studio export/);
    expect(() => readNativeExport([])).toThrow(/not an API Studio export/);
    expect(() => readNativeExport({ format: 'api-studio' })).toThrow(/version/);
    expect(() => readNativeExport({ format: 'api-studio', version: 99 })).toThrow(/newer version/);
    expect(() => readNativeExport({ format: 'api-studio', version: 1 })).not.toThrow();
    expect(() => readNativeExport({ format: 'api-studio', version: 1, requests: 'x' })).toThrow(/must be a list/);
  });

  it('skips invalid entries and says so, instead of failing the whole import', () => {
    const bundle = readNativeExport({
      format: 'api-studio', version: 1,
      collections: [{ id: 'c1', name: 'Keep' }, { name: 'no id' }, 7, { id: 'c1', name: 'duplicate' }],
      folders: [{ id: 'f1', collectionId: 'c1', name: 'ok' }, { id: 'f2', collectionId: 'nope', name: 'orphan' }],
      requests: [
        { id: 'r1', collectionId: 'c1', folderId: 'f1', name: 'ok', definition: { method: 'GET', url: 'https://x.test' } },
        { id: 'r2', collectionId: 'c1', folderId: null, name: 'bad method', definition: { method: 'NOT A METHOD', url: '' } },
        { id: 'r3', collectionId: 'zzz', folderId: null, name: 'orphan', definition: { method: 'GET', url: '' } },
        { id: 'r4', collectionId: 'c1', folderId: 'missing', name: 'bad folder', definition: { method: 'GET', url: '' } },
        { id: 'r5', collectionId: 'c1', folderId: null, name: 'no definition' },
      ],
    });
    expect(bundle.collections.map((c) => c.name)).toEqual(['Keep']);
    expect(bundle.folders.map((f) => f.name)).toEqual(['ok']);
    expect(bundle.requests.map((r) => r.name)).toEqual(['ok']);
    expect(bundle.warnings.length).toBeGreaterThanOrEqual(3);
  });

  it('drops folders in a parent cycle and anything inside them', () => {
    const bundle = readNativeExport({
      format: 'api-studio', version: 1,
      collections: [{ id: 'c', name: 'C' }],
      folders: [
        { id: 'a', collectionId: 'c', parentId: 'b', name: 'a' },
        { id: 'b', collectionId: 'c', parentId: 'a', name: 'b' },
        { id: 'ok', collectionId: 'c', parentId: null, name: 'ok' },
      ],
      requests: [{ id: 'r', collectionId: 'c', folderId: 'a', name: 'inside cycle', definition: { method: 'GET', url: '' } }],
    });
    expect(bundle.folders.map((f) => f.name)).toEqual(['ok']);
    expect(bundle.requests).toEqual([]);
    expect(bundle.warnings.join(' ')).toMatch(/circular/);
  });

  it('rejects a folder whose parent is in a different collection', () => {
    const bundle = readNativeExport({
      format: 'api-studio', version: 1,
      collections: [{ id: 'c1', name: 'One' }, { id: 'c2', name: 'Two' }],
      folders: [
        { id: 'p', collectionId: 'c1', parentId: null, name: 'parent' },
        { id: 'k', collectionId: 'c2', parentId: 'p', name: 'cross' },
      ],
    });
    expect(bundle.folders.map((f) => f.name)).toEqual(['parent']);
  });

  it('rebuilds definitions from known fields only and normalizes odd values', () => {
    const bundle = readNativeExport({
      format: 'api-studio', version: 1,
      collections: [{ id: 'c', name: 'C' }],
      requests: [{
        id: 'r', collectionId: 'c', name: 'x',
        definition: {
          method: 'post', url: 5, evil: { polluted: true },
          headers: [{ key: 'A', value: 1, enabled: 'yes' }],
          auth: { type: 'sorcery', password: 'x' },
          body: { type: 'text', language: 'cobol', content: 'hi' },
          options: { timeoutMs: -5, redirect: 'teleport', credentials: 'include' },
        },
      }],
    });
    const d = bundle.requests[0].definition;
    expect(d.method).toBe('POST');
    expect(d.url).toBe('');
    expect(d.headers).toMatchObject([{ key: 'A', value: '', enabled: true }]);
    expect(d.auth).toEqual({ type: 'none' });
    expect(d.body).toEqual({ type: 'text', language: 'text', content: 'hi' });
    expect(d.options).toEqual({ timeoutMs: 0, redirect: 'follow', credentials: 'include' });
    expect('evil' in d).toBe(false);
    expect(bundle.warnings.join(' ')).toMatch(/unknown authorization/);
  });

  it('keeps file references but never file contents, and warns about unsendable URLs', () => {
    const bundle = readNativeExport({
      format: 'api-studio', version: 1,
      collections: [{ id: 'c', name: 'C' }],
      requests: [{
        id: 'r', collectionId: 'c', name: 'upload',
        definition: {
          method: 'POST', url: 'ftp://x.test/f',
          body: { type: 'multipart', fields: [{ key: 'doc', kind: 'file', file: { name: 'a.pdf', size: 12, mimeType: 'application/pdf', content: 'AAAA' } }] },
        },
      }],
    });
    const body = bundle.requests[0].definition.body;
    expect(body).toMatchObject({ type: 'multipart', fields: [{ kind: 'file', file: { name: 'a.pdf', size: 12 } }] });
    expect(JSON.stringify(body)).not.toContain('AAAA');
    expect(bundle.warnings.join(' ')).toMatch(/"ftp:"/);
  });

  it('long names are shortened and blank ones replaced', () => {
    const bundle = readNativeExport({ format: 'api-studio', version: 1, collections: [{ id: 'c', name: 'x'.repeat(500) }, { id: 'd', name: '   ' }] });
    expect(bundle.collections[0].name).toHaveLength(120);
    expect(bundle.collections[1].name).toBe('Imported collection');
  });

  it('round-trips assertions, extractions, GraphQL bodies and OAuth settings', () => {
    const rich: ExportSource = {
      ...source,
      requests: [request('r1', {
        definition: {
          ...createEmptyRequest(), method: 'POST', url: 'https://a.test/graphql',
          auth: { type: 'oauth2', authorizationUrl: 'https://id.test/authorize', tokenUrl: 'https://id.test/token', clientId: 'app', scope: 'read' },
          body: { type: 'graphql', query: '{ me { id } }', variables: '{"a":1}', operationName: 'Me' },
          assertions: [{ id: 'x', enabled: true, target: 'json', property: '$.data.me.id', operator: 'exists', expected: '' }],
          extractions: [{ id: 'y', enabled: false, variable: 'userId', source: 'json', expression: '$.data.me.id', secret: true }],
        },
      })],
    };
    const d = roundTrip(buildNativeExport(rich, { includeSecrets: false })).requests[0].definition;
    expect(d.auth).toEqual({ type: 'oauth2', authorizationUrl: 'https://id.test/authorize', tokenUrl: 'https://id.test/token', clientId: 'app', scope: 'read' });
    expect(d.body).toEqual({ type: 'graphql', query: '{ me { id } }', variables: '{"a":1}', operationName: 'Me' });
    expect(d.assertions).toMatchObject([{ target: 'json', property: '$.data.me.id', operator: 'exists', enabled: true }]);
    expect(d.extractions).toMatchObject([{ variable: 'userId', source: 'json', secret: true, enabled: false }]);
  });

  it('imports scripts switched off, whatever the file says, and tells the user', () => {
    const withScripts: ExportSource = {
      ...source,
      requests: [request('r1', { definition: { ...createEmptyRequest(), url: 'https://a.test', scripts: { enabled: true, preRequest: 'env.set("a","1")', test: '' } } })],
    };
    const bundle = roundTrip(buildNativeExport(withScripts, { includeSecrets: true }));
    expect(bundle.requests[0].definition.scripts).toEqual({ enabled: false, preRequest: 'env.set("a","1")', test: '' });
    expect(bundle.warnings.join(' ')).toMatch(/imported switched off/);
  });

  it('drops empty scripts and ignores malformed test rows', () => {
    const bundle = readNativeExport({
      format: 'api-studio', version: 2,
      collections: [{ id: 'c', name: 'C' }],
      requests: [{ id: 'r', collectionId: 'c', name: 'x', definition: {
        method: 'GET', url: 'https://a.test', scripts: { enabled: true, preRequest: '  ', test: '' },
        assertions: [{ target: 'nonsense', operator: 'telepathy', expected: 5 }, 'junk'],
      } }],
    });
    const d = bundle.requests[0].definition;
    expect(d.scripts).toBeUndefined();
    expect(d.assertions).toMatchObject([{ target: 'status', operator: 'equals', expected: '' }]);
    expect(bundle.warnings).toEqual([]);
  });
});
