import { jsonChildren, jsonKind, jsonScalarText, jsonSummary, MAX_TREE_STRING, parseJson } from './json-tree.util';

describe('json tree util', () => {
  it('classifies values', () => {
    expect(['x', 1, true, null, [], {}].map(jsonKind)).toEqual(['string', 'number', 'boolean', 'null', 'array', 'object']);
  });

  it('lists children of objects and arrays in order, and none for scalars', () => {
    expect(jsonChildren({ b: 1, a: 2 })).toEqual([['b', 1], ['a', 2]]);
    expect(jsonChildren(['x', 'y'])).toEqual([['0', 'x'], ['1', 'y']]);
    expect(jsonChildren('text')).toEqual([]);
    expect(jsonChildren(null)).toEqual([]);
  });

  it('summarizes containers with correct plurals', () => {
    expect(jsonSummary({ a: 1 })).toBe('{1 key}');
    expect(jsonSummary({ a: 1, b: 2 })).toBe('{2 keys}');
    expect(jsonSummary([])).toBe('[0 items]');
    expect(jsonSummary([1])).toBe('[1 item]');
  });

  it('quotes strings, escapes them, and shortens very long ones', () => {
    expect(jsonScalarText('a"b')).toBe('"a\\"b"');
    expect(jsonScalarText(null)).toBe('null');
    expect(jsonScalarText(false)).toBe('false');
    const long = jsonScalarText('x'.repeat(MAX_TREE_STRING + 5));
    expect(long.endsWith('…"')).toBe(true);
    expect(long.length).toBe(MAX_TREE_STRING + 3);
  });

  it('does not treat a prototype key as special', () => {
    const parsed = parseJson('{"__proto__": {"x": 1}}');
    expect(parsed.ok && jsonChildren(parsed.value)).toEqual([['__proto__', { x: 1 }]]);
    expect(({} as Record<string, unknown>)['x']).toBeUndefined();
  });

  it('reports invalid JSON without throwing', () => {
    expect(parseJson('{nope')).toEqual({ ok: false });
    expect(parseJson('[1]')).toEqual({ ok: true, value: [1] });
  });
});
