import { ImportError, MAX_JSON_DEPTH, parseUntrustedJson } from './safe-json.util';

describe('parseUntrustedJson', () => {
  it('parses ordinary JSON', () => {
    expect(parseUntrustedJson('{"a":[1,{"b":"c"}]}')).toEqual({ a: [1, { b: 'c' }] });
  });

  it('rejects text over the size limit before parsing', () => {
    expect(() => parseUntrustedJson('x'.repeat(11), 10)).toThrow(/import limit/);
  });

  it('rejects invalid JSON with a helpful message', () => {
    expect(() => parseUntrustedJson('openapi: 3.0.0')).toThrow(/not valid JSON/);
    expect(() => parseUntrustedJson('{"a":')).toThrow(ImportError);
  });

  it.each(['__proto__', 'constructor', 'prototype'])('rejects a "%s" key at the top level, nested, and inside arrays', (key) => {
    expect(() => parseUntrustedJson(`{"${key}":1}`)).toThrow(/forbidden key/);
    expect(() => parseUntrustedJson(`{"a":{"b":{"${key}":{}}}}`)).toThrow(/forbidden key/);
    expect(() => parseUntrustedJson(`[1,[{"${key}":1}]]`)).toThrow(/forbidden key/);
  });

  it('does not pollute Object.prototype even when it rejects', () => {
    expect(() => parseUntrustedJson('{"__proto__":{"polluted":true}}')).toThrow();
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('allows keys that merely contain a forbidden word', () => {
    expect(parseUntrustedJson('{"my_constructor":1,"prototypes":2}')).toEqual({ my_constructor: 1, prototypes: 2 });
  });

  it('rejects excessive nesting without overflowing the stack', () => {
    const deep = '['.repeat(MAX_JSON_DEPTH + 5) + ']'.repeat(MAX_JSON_DEPTH + 5);
    expect(() => parseUntrustedJson(deep)).toThrow(/levels deep/);
    const veryDeep = '['.repeat(2000) + ']'.repeat(2000);
    expect(() => parseUntrustedJson(veryDeep)).toThrow(ImportError);
  });
});
