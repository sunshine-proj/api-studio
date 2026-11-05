import { KeyValue } from '../models';
import { buildUrl, encodeQueryComponent, paramsFromUrl, parseQuery, splitUrl, validateUrl } from './url.util';

const row = (key: string, value: string, enabled = true, id = key + value): KeyValue => ({ id, key, value, enabled });

describe('url util', () => {
  it('splits base, query and hash', () => {
    expect(splitUrl('http://a/b?x=1&y=2#top')).toEqual({ base: 'http://a/b', query: 'x=1&y=2', hash: '#top' });
    expect(splitUrl('http://a/b')).toEqual({ base: 'http://a/b', query: null, hash: '' });
  });

  it('encodes components but keeps {{variables}} readable', () => {
    expect(encodeQueryComponent('a b&c')).toBe('a%20b%26c');
    expect(encodeQueryComponent('{{id}} x')).toBe('{{id}}%20x');
  });

  it('parses repeated keys, empty values and malformed escapes', () => {
    expect(parseQuery('a=1&a=2&b&c=%zz&&d=x%20y')).toEqual([
      { key: 'a', value: '1' },
      { key: 'a', value: '2' },
      { key: 'b', value: '' },
      { key: 'c', value: '%zz' },
      { key: 'd', value: 'x y' },
    ]);
  });

  it('builds the URL from enabled, non-blank params and keeps the hash', () => {
    const url = buildUrl('http://a/b?old=1#h', [row('q', 'a b'), row('off', '1', false), row('', ''), row('q', '2')]);
    expect(url).toBe('http://a/b?q=a%20b&q=2#h');
  });

  it('removes the query when no params are enabled', () => {
    expect(buildUrl('http://a/b?x=1', [row('x', '1', false)])).toBe('http://a/b');
  });

  it('syncs params from the URL, keeping ids and disabled rows', () => {
    const existing = [row('a', '1', true, 'id-a'), row('skip', 'z', false, 'id-skip'), row('b', '2', true, 'id-b')];
    const result = paramsFromUrl('http://x?a=9&b=8&c=7', existing);
    expect(result.map((p) => [p.id === 'id-a' || p.id === 'id-skip' || p.id === 'id-b', p.key, p.value, p.enabled])).toEqual([
      [true, 'a', '9', true],
      [true, 'skip', 'z', false],
      [true, 'b', '8', true],
      [false, 'c', '7', true],
    ]);
  });

  it('drops enabled rows that no longer appear in the URL', () => {
    const result = paramsFromUrl('http://x', [row('a', '1')]);
    expect(result).toEqual([]);
  });

  it('validates only http and https URLs', () => {
    expect(validateUrl('https://example.com/x').ok).toBe(true);
    expect(validateUrl('').ok).toBe(false);
    expect(validateUrl('example.com').ok).toBe(false);
    expect(validateUrl('ftp://example.com')).toEqual({ ok: false, reason: 'Only http: and https: URLs are supported.' });
    expect(validateUrl('javascript:alert(1)').ok).toBe(false);
  });
});
