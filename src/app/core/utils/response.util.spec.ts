import { decodeBody, detectBodyKind, formatBytes, formatDuration, prettyPrintJson, statusDescription } from './response.util';

describe('response util', () => {
  it('detects body kinds from content types', () => {
    expect(detectBodyKind('application/json; charset=utf-8')).toBe('json');
    expect(detectBodyKind('application/problem+json')).toBe('json');
    expect(detectBodyKind('text/html')).toBe('html');
    expect(detectBodyKind('application/atom+xml')).toBe('xml');
    expect(detectBodyKind('text/plain')).toBe('text');
    expect(detectBodyKind('image/png')).toBe('image');
    expect(detectBodyKind('application/pdf')).toBe('binary');
    expect(detectBodyKind(null)).toBe('text');
  });

  it('falls back to the standard reason phrase when statusText is empty', () => {
    expect(statusDescription(404, '')).toBe('Not Found');
    expect(statusDescription(200, 'Fine')).toBe('Fine');
    expect(statusDescription(299, '')).toBe('');
  });

  it('formats sizes and durations', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatDuration(120.4)).toBe('120 ms');
    expect(formatDuration(1500)).toBe('1.50 s');
  });

  it('pretty prints valid JSON only', () => {
    expect(prettyPrintJson('{"a":1}')).toBe('{\n  "a": 1\n}');
    expect(prettyPrintJson('nope')).toBeNull();
  });

  it('decodes using the declared charset and survives unknown ones', async () => {
    const latin1 = new Blob([new Uint8Array([0xe9])]);
    expect(await decodeBody(latin1, 'text/plain; charset=iso-8859-1')).toBe('é');
    expect(await decodeBody(new Blob(['ok']), 'text/plain; charset=bogus')).toBe('ok');
  });
});
