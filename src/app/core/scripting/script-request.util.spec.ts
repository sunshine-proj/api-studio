import { RequestDefinition } from '../models';
import { createEmptyRequest } from '../utils/request-factory';
import { applyScriptRequest, toScriptRequest } from './script-request.util';

const kv = (key: string, value: string, enabled = true) => ({ id: key, key, value, enabled });
const base: RequestDefinition = {
  ...createEmptyRequest(),
  method: 'POST',
  url: '{{baseUrl}}/x?a=1',
  params: [kv('a', '1')],
  headers: [kv('Accept', 'json'), kv('X-Old', 'old'), kv('X-Off', 'off', false)],
  body: { type: 'text', language: 'json', content: '{"a":1}' },
};

describe('script request mapping', () => {
  it('shows enabled headers and the text body, with variables left intact', () => {
    expect(toScriptRequest(base)).toEqual({
      method: 'POST', url: '{{baseUrl}}/x?a=1', headers: { Accept: 'json', 'X-Old': 'old' }, body: '{"a":1}',
    });
    expect(toScriptRequest({ ...base, body: { type: 'none' } }).body).toBeNull();
  });

  it('applies method, url, header and body changes to a copy', () => {
    const view = { method: 'put', url: 'https://b.test/y?b=2', headers: { accept: 'xml', 'X-New': 'n' }, body: '{"b":2}' };
    const result = applyScriptRequest(base, view);
    expect(result.method).toBe('put');
    expect(result.url).toBe('https://b.test/y?b=2');
    expect(result.params.map((p) => [p.key, p.value])).toEqual([['b', '2']]);
    expect(result.headers.map((h) => [h.key, h.value, h.enabled])).toEqual([
      ['Accept', 'xml', true], // matched case-insensitively, original name kept
      ['X-Off', 'off', false], // disabled rows are untouched
      ['X-New', 'n', true],
    ]);
    expect(result.body).toEqual({ type: 'text', language: 'json', content: '{"b":2}' });
    expect(base.url).toBe('{{baseUrl}}/x?a=1'); // the original is unchanged
  });

  it('removes a header the script deleted', () => {
    const result = applyScriptRequest(base, { ...toScriptRequest(base), headers: { Accept: 'json' } });
    expect(result.headers.map((h) => h.key)).toEqual(['Accept', 'X-Off']);
  });

  it('creates a text body when a script sets one on a request without a body, and ignores non-text bodies', () => {
    const none = { ...base, body: { type: 'none' } as const };
    expect(applyScriptRequest(none, { ...toScriptRequest(none), body: 'hi' }).body).toEqual({ type: 'text', language: 'text', content: 'hi' });
    expect(applyScriptRequest(none, { ...toScriptRequest(none), body: '' }).body).toEqual({ type: 'none' });
    const form = { ...base, body: { type: 'urlencoded', fields: [] } as const };
    expect(applyScriptRequest(form, { ...toScriptRequest(form), body: 'x' }).body).toBe(form.body);
  });

  it('keeps the method when a script blanks it', () => {
    expect(applyScriptRequest(base, { ...toScriptRequest(base), method: '  ' }).method).toBe('POST');
  });
});
