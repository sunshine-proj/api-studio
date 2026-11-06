import { lookupJsonPath, parseJsonPath, valueToText } from './json-path.util';

const doc = { data: { items: [{ id: 7, tags: ['a', 'b'] }, { id: 8 }], 'odd key': 1, nothing: null }, list: [10, 20, 30] };

describe('JSON path', () => {
  it('parses dots, indexes, negative indexes and quoted names', () => {
    expect(parseJsonPath('$.data.items[0].id')).toEqual(['data', 'items', 0, 'id']);
    expect(parseJsonPath('data.items[1]')).toEqual(['data', 'items', 1]);
    expect(parseJsonPath("$['data']['odd key']")).toEqual(['data', 'odd key']);
    expect(parseJsonPath('$.list[-1]')).toEqual(['list', -1]);
    expect(parseJsonPath('$')).toEqual([]);
  });

  it('rejects malformed paths and unsupported syntax', () => {
    for (const bad of ['', '$.', '$..a', '$.a[', '$.a[*]', '$.a[?(@.b)]', '$.a b']) {
      expect(parseJsonPath(bad)).toBeNull();
    }
  });

  it('finds values, including null', () => {
    expect(lookupJsonPath(doc, '$.data.items[0].id')).toEqual({ found: true, value: 7 });
    expect(lookupJsonPath(doc, '$.data.items[0].tags[1]')).toEqual({ found: true, value: 'b' });
    expect(lookupJsonPath(doc, "$.data['odd key']")).toEqual({ found: true, value: 1 });
    expect(lookupJsonPath(doc, '$.data.nothing')).toEqual({ found: true, value: null });
    expect(lookupJsonPath(doc, '$.list[-1]')).toEqual({ found: true, value: 30 });
    expect(lookupJsonPath(doc, '$')).toEqual({ found: true, value: doc });
  });

  it('reports missing values', () => {
    for (const path of ['$.nope', '$.data.items[5]', '$.list[-9]', '$.list.length', '$.data.items.id', '$.data.nothing.x', '$.list[bad']) {
      expect(lookupJsonPath(doc, path).found).toBe(false);
    }
  });

  it('never reads inherited properties', () => {
    for (const path of ['$.constructor', '$.__proto__', '$.toString', '$.data.hasOwnProperty', "$['__proto__']"]) {
      expect(lookupJsonPath(doc, path).found).toBe(false);
    }
  });

  it('converts values to text', () => {
    expect(valueToText('x')).toBe('x');
    expect(valueToText(5)).toBe('5');
    expect(valueToText(true)).toBe('true');
    expect(valueToText(null)).toBe('null');
    expect(valueToText({ a: 1 })).toBe('{"a":1}');
    expect(valueToText(undefined)).toBe('');
  });
});
