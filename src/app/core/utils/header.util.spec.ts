import { KeyValue } from '../models';
import { isForbiddenHeader, prepareHeaders } from './header.util';

const row = (key: string, value: string, enabled = true): KeyValue => ({ id: key, key, value, enabled });

describe('header util', () => {
  it('detects forbidden headers case-insensitively, including prefixes', () => {
    expect(isForbiddenHeader('Host')).toBe(true);
    expect(isForbiddenHeader('cOOkie')).toBe(true);
    expect(isForbiddenHeader('Proxy-Authorization')).toBe(true);
    expect(isForbiddenHeader('Sec-Fetch-Mode')).toBe(true);
    expect(isForbiddenHeader('X-Custom')).toBe(false);
  });

  it('resolves variables, skips disabled and blank rows and keeps duplicates', () => {
    const result = prepareHeaders(
      [row('X-A', '{{v}}'), row('X-A', '2'), row('X-Off', '1', false), row('', '')],
      new Map([['v', '1']]),
    );
    expect(result.headers).toEqual([
      { name: 'X-A', value: '1' },
      { name: 'X-A', value: '2' },
    ]);
    expect(result.warnings).toEqual([]);
  });

  it('reports forbidden, invalid and line-break headers instead of dropping them silently', () => {
    const result = prepareHeaders([row('Host', 'x'), row('bad name', 'x'), row('X-Ok', 'a\r\nb')], new Map());
    expect(result.headers).toEqual([]);
    expect(result.warnings).toHaveLength(3);
    expect(result.warnings[0]).toContain('"Host"');
  });

  it('reports unresolved variables', () => {
    expect(prepareHeaders([row('X', '{{nope}}')], new Map()).unresolved).toEqual(['nope']);
  });
});
