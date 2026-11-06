import { RequestDefinition } from '../models';
import { createEmptyRequest } from './request-factory';
import { MAX_HISTORY_BODY_CHARS, REDACTED, limitBodySize, redactDefinition } from './redaction.util';

const kv = (key: string, value: string) => ({ id: key, key, value, enabled: true });
const request = (over: Partial<RequestDefinition>): RequestDefinition => ({ ...createEmptyRequest(), ...over });

describe('redactDefinition', () => {
  it('redacts literal Authorization header values, whatever the case', () => {
    const result = redactDefinition(
      request({ headers: [kv('Authorization', 'Bearer abc123xyz'), kv('PROXY-authorization', 'Basic Zm9v'), kv('Accept', 'json')] }),
      [],
    );
    expect(result.headers.map((h) => h.value)).toEqual([REDACTED, REDACTED, 'json']);
  });

  it('keeps an Authorization header that only references variables', () => {
    const result = redactDefinition(request({ headers: [kv('Authorization', 'Bearer {{token}}')] }), []);
    expect(result.headers[0].value).toBe('Bearer {{token}}');
  });

  it('empties literal credentials in the auth settings but keeps placeholders and usernames', () => {
    const basic = redactDefinition(request({ auth: { type: 'basic', username: 'ann', password: 'hunter22' } }), []);
    expect(basic.auth).toEqual({ type: 'basic', username: 'ann', password: '' });

    expect(redactDefinition(request({ auth: { type: 'bearer', token: 'tok-literal' } }), []).auth).toEqual({ type: 'bearer', token: '' });
    expect(redactDefinition(request({ auth: { type: 'bearer', token: '{{token}}' } }), []).auth).toEqual({ type: 'bearer', token: '{{token}}' });
    expect(
      redactDefinition(request({ auth: { type: 'apiKey', key: 'X-Key', value: 'k-literal', placement: 'query' } }), []).auth,
    ).toEqual({ type: 'apiKey', key: 'X-Key', value: '', placement: 'query' });
    expect(
      redactDefinition(request({ auth: { type: 'custom', headerName: 'X-Auth', headerValue: 'lit' } }), []).auth,
    ).toEqual({ type: 'custom', headerName: 'X-Auth', headerValue: '' });
    expect(redactDefinition(request({ auth: { type: 'none' } }), []).auth).toEqual({ type: 'none' });
  });

  it('replaces secret variable values with their placeholder everywhere', () => {
    const secrets = [{ name: 'apiKey', value: 's3cr3t-value' }];
    const result = redactDefinition(
      request({
        url: 'https://a.test/x?key=s3cr3t-value',
        params: [kv('key', 's3cr3t-value')],
        headers: [kv('X-Custom', 'pre-s3cr3t-value')],
        body: { type: 'text', language: 'json', content: '{"k":"s3cr3t-value","again":"s3cr3t-value"}' },
      }),
      secrets,
    );
    expect(result.url).toBe('https://a.test/x?key={{apiKey}}');
    expect(result.params[0].value).toBe('{{apiKey}}');
    expect(result.headers[0].value).toBe('pre-{{apiKey}}');
    expect(result.body).toMatchObject({ content: '{"k":"{{apiKey}}","again":"{{apiKey}}"}' });
    expect(JSON.stringify(result)).not.toContain('s3cr3t-value');
  });

  it('redacts secrets in urlencoded and multipart fields', () => {
    const secrets = [{ name: 'pw', value: 'open-sesame' }];
    const urlencoded = redactDefinition(request({ body: { type: 'urlencoded', fields: [kv('p', 'open-sesame')] } }), secrets);
    expect(urlencoded.body).toMatchObject({ fields: [{ value: '{{pw}}' }] });
    const multipart = redactDefinition(
      request({ body: { type: 'multipart', fields: [{ id: '1', key: 'p', kind: 'text', value: 'open-sesame', enabled: true }] } }),
      secrets,
    );
    expect(multipart.body).toMatchObject({ fields: [{ value: '{{pw}}' }] });
  });

  it('replaces the longest secret first when one contains another', () => {
    const result = redactDefinition(request({ url: 'https://a.test/abcdefgh' }), [
      { name: 'short', value: 'abcd' },
      { name: 'long', value: 'abcdefgh' },
    ]);
    expect(result.url).toBe('https://a.test/{{long}}');
  });

  it('ignores secrets too short to search for safely', () => {
    const result = redactDefinition(request({ url: 'https://a.test/abc' }), [{ name: 'x', value: 'abc' }]);
    expect(result.url).toBe('https://a.test/abc');
  });

  it('does not modify its input', () => {
    const original = request({ headers: [kv('Authorization', 'Bearer abc')] });
    const snapshot = JSON.stringify(original);
    redactDefinition(original, [{ name: 'a', value: 'abcdef' }]);
    expect(JSON.stringify(original)).toBe(snapshot);
  });
});

describe('limitBodySize', () => {
  it('cuts oversized text bodies and says so', () => {
    const big = request({ body: { type: 'text', language: 'text', content: 'x'.repeat(MAX_HISTORY_BODY_CHARS + 10) } });
    const { definition, truncated } = limitBodySize(big);
    expect(truncated).toBe(true);
    expect(definition.body).toMatchObject({ content: 'x'.repeat(MAX_HISTORY_BODY_CHARS) });
  });

  it('leaves small and non-text bodies alone', () => {
    const small = request({ body: { type: 'text', language: 'text', content: 'ok' } });
    expect(limitBodySize(small)).toEqual({ definition: small, truncated: false });
    const none = request({});
    expect(limitBodySize(none).truncated).toBe(false);
  });
});
