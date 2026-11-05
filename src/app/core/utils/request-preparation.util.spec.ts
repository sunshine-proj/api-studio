import { RequestDefinition } from '../models';
import { BINARY_FILE_KEY, prepareRequest, toBase64Utf8 } from './request-preparation.util';
import { createEmptyRequest } from './request-factory';

const def = (patch: Partial<RequestDefinition>): RequestDefinition => ({ ...createEmptyRequest(), ...patch });
const noVars = new Map<string, string>();

describe('prepareRequest', () => {
  it('rejects an empty or invalid URL', () => {
    const result = prepareRequest(def({ url: '' }), noVars);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('invalid-request');
  });

  it('resolves variables in the URL', () => {
    const result = prepareRequest(def({ url: '{{base}}/users' }), new Map([['base', 'https://api.test']]));
    expect(result.ok && result.request.url).toBe('https://api.test/users');
  });

  it('warns about undefined variables and sends them as written', () => {
    const result = prepareRequest(def({ url: 'https://api.test/{{id}}' }), noVars);
    expect(result.ok).toBe(true);
    expect(result.warnings.join()).toContain('{{id}}');
  });

  it('uppercases standard methods and rejects forbidden or invalid ones', () => {
    const ok = prepareRequest(def({ url: 'https://a.test', method: 'patch' }), noVars);
    expect(ok.ok && ok.request.method).toBe('PATCH');
    expect(prepareRequest(def({ url: 'https://a.test', method: 'TRACE' }), noVars).ok).toBe(false);
    expect(prepareRequest(def({ url: 'https://a.test', method: 'BAD METHOD' }), noVars).ok).toBe(false);
  });

  it('adds a JSON content type for text bodies unless the user set one', () => {
    const body = { type: 'text', language: 'json', content: '{"a":"{{v}}"}' } as const;
    const auto = prepareRequest(def({ url: 'https://a.test', method: 'POST', body }), new Map([['v', '1']]));
    expect(auto.ok && auto.request.headers).toEqual([{ name: 'Content-Type', value: 'application/json' }]);
    expect(auto.ok && auto.request.body).toEqual({ type: 'text', content: '{"a":"1"}' });

    const custom = prepareRequest(
      def({
        url: 'https://a.test',
        method: 'POST',
        body,
        headers: [{ id: '1', key: 'content-type', value: 'application/vnd.api+json', enabled: true }],
      }),
      noVars,
    );
    expect(custom.ok && custom.request.headers).toEqual([{ name: 'content-type', value: 'application/vnd.api+json' }]);
  });

  it('never sends a body with GET or HEAD', () => {
    const body = { type: 'text', language: 'json', content: '{}' } as const;
    for (const method of ['GET', 'HEAD']) {
      const result = prepareRequest(def({ url: 'https://a.test', method, body }), noVars);
      expect(result.ok && result.request.body).toEqual({ type: 'none' });
      expect(result.warnings.join()).toContain('cannot have a body');
    }
  });
});

describe('prepareRequest authorization', () => {
  const header = (result: ReturnType<typeof prepareRequest>, name: string): string | undefined =>
    result.ok ? result.request.headers.find((h) => h.name === name)?.value : undefined;
  const withAuth = (auth: RequestDefinition['auth'], patch: Partial<RequestDefinition> = {}, vars = noVars) =>
    prepareRequest(def({ url: 'https://a.test/x', auth, ...patch }), vars);

  it('encodes Basic credentials as UTF-8 base64', () => {
    const result = withAuth({ type: 'basic', username: 'user', password: 'pä:ss' });
    expect(header(result, 'Authorization')).toBe(`Basic ${toBase64Utf8('user:pä:ss')}`);
    expect(atob(toBase64Utf8('é'))).toBe('Ã©');
  });

  it('sends Bearer tokens with variables resolved', () => {
    const result = withAuth({ type: 'bearer', token: '{{t}}' }, {}, new Map([['t', 'abc']]));
    expect(header(result, 'Authorization')).toBe('Bearer abc');
  });

  it('places API keys in a header or the query string', () => {
    expect(header(withAuth({ type: 'apiKey', key: 'X-Key', value: 'k', placement: 'header' }), 'X-Key')).toBe('k');
    const query = withAuth({ type: 'apiKey', key: 'api key', value: 'a&b', placement: 'query' }, { url: 'https://a.test/x?q=1' });
    expect(query.ok && query.request.url).toBe('https://a.test/x?q=1&api+key=a%26b');
  });

  it('supports custom authorization headers and refuses forbidden ones', () => {
    expect(header(withAuth({ type: 'custom', headerName: 'X-Auth', headerValue: 'v' }), 'X-Auth')).toBe('v');
    const forbidden = withAuth({ type: 'custom', headerName: 'Cookie', headerValue: 'v' });
    expect(header(forbidden, 'Cookie')).toBeUndefined();
    expect(forbidden.warnings.join()).toContain('Cookie');
  });

  it('replaces a manually set Authorization header and says so', () => {
    const result = withAuth(
      { type: 'bearer', token: 't' },
      { headers: [{ id: '1', key: 'authorization', value: 'old', enabled: true }] },
    );
    expect(result.ok && result.request.headers.filter((h) => h.name.toLowerCase() === 'authorization')).toEqual([
      { name: 'Authorization', value: 'Bearer t' },
    ]);
    expect(result.warnings.join()).toContain('replaced');
  });

  it('warns instead of sending empty credentials', () => {
    const result = withAuth({ type: 'bearer', token: '  ' });
    expect(header(result, 'Authorization')).toBeUndefined();
    expect(result.warnings.join()).toContain('empty');
  });
});

describe('prepareRequest bodies', () => {
  const post = (body: RequestDefinition['body'], extra: Partial<RequestDefinition> = {}, files = new Map<string, Blob>()) =>
    prepareRequest(def({ url: 'https://a.test/x', method: 'POST', body, ...extra }), new Map([['v', 'val']]), files);
  const contentType = (r: ReturnType<typeof post>): string | undefined =>
    r.ok ? r.request.headers.find((h) => h.name.toLowerCase() === 'content-type')?.value : undefined;

  it('sets content types for XML, text and JavaScript bodies', () => {
    for (const [language, type] of [['xml', 'application/xml'], ['text', 'text/plain'], ['javascript', 'application/javascript']] as const) {
      expect(contentType(post({ type: 'text', language, content: 'x' }))).toBe(type);
    }
  });

  it('serializes URL-encoded forms with repeated keys and variables', () => {
    const result = post({
      type: 'urlencoded',
      fields: [
        { id: '1', key: 'a', value: 'x y', enabled: true },
        { id: '2', key: 'a', value: '{{v}}&', enabled: true },
        { id: '3', key: 'off', value: '1', enabled: false },
        { id: '4', key: '', value: '', enabled: true },
      ],
    });
    expect(result.ok && result.request.body).toEqual({ type: 'text', content: 'a=x+y&a=val%26' });
    expect(contentType(result)).toBe('application/x-www-form-urlencoded;charset=UTF-8');
  });

  it('builds multipart fields in order with files, repeated names and no Content-Type', () => {
    const file1 = new Blob(['1']);
    const file2 = new Blob(['2']);
    const result = post(
      {
        type: 'multipart',
        fields: [
          { id: 't', key: 'note', kind: 'text', value: '{{v}}', enabled: true },
          { id: 'f1', key: 'files', kind: 'file', value: '', enabled: true, file: { name: 'a.txt', size: 1, mimeType: '' } },
          { id: 'f2', key: 'files', kind: 'file', value: '', enabled: true, file: { name: 'b.txt', size: 1, mimeType: '' } },
          { id: 'off', key: 'skip', kind: 'text', value: 'x', enabled: false },
        ],
      },
      { headers: [{ id: 'h', key: 'Content-Type', value: 'multipart/form-data', enabled: true }] },
      new Map([['f1', file1], ['f2', file2]]),
    );
    expect(result.ok && result.request.body).toEqual({
      type: 'multipart',
      fields: [
        { kind: 'text', name: 'note', value: 'val' },
        { kind: 'file', name: 'files', blob: file1, filename: 'a.txt' },
        { kind: 'file', name: 'files', blob: file2, filename: 'b.txt' },
      ],
    });
    expect(contentType(result)).toBeUndefined();
    expect(result.warnings.join()).toContain('boundary');
  });

  it('fails clearly when a selected file is no longer available', () => {
    const result = post({
      type: 'multipart',
      fields: [{ id: 'f', key: 'doc', kind: 'file', value: '', enabled: true, file: { name: 'a.txt', size: 1, mimeType: '' } }],
    });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.message).toContain('"doc"');
  });

  it('sends binary bodies with the file type, and fails without a file', () => {
    const blob = new Blob(['abc'], { type: 'image/png' });
    const ok = post({ type: 'binary', file: { name: 'a.png', size: 3, mimeType: 'image/png' } }, {}, new Map([[BINARY_FILE_KEY, blob]]));
    expect(ok.ok && ok.request.body).toEqual({ type: 'binary', blob });
    expect(contentType(ok)).toBe('image/png');
    expect(post({ type: 'binary' }).ok).toBe(false);
  });

  it('never sends multipart or binary bodies with GET', () => {
    const result = prepareRequest(def({ url: 'https://a.test', method: 'GET', body: { type: 'binary' } }), noVars);
    expect(result.ok && result.request.body).toEqual({ type: 'none' });
  });
});
