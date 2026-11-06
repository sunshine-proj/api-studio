import { readScriptOutcome, readScriptRequest } from './script-outcome.util';

const fallback = { keep: 'me' };

describe('readScriptOutcome (the worker message is untrusted)', () => {
  it('accepts a well-formed result', () => {
    const outcome = readScriptOutcome(
      { type: 'result', error: null, logs: ['a'], tests: [{ name: 't', passed: true, message: '' }], env: { x: '1' }, request: { method: 'GET', url: 'u', headers: { A: 'b' }, body: null } },
      fallback,
    );
    expect(outcome).toMatchObject({ ok: true, error: null, logs: ['a'], env: { x: '1' }, request: { method: 'GET', url: 'u', headers: { A: 'b' }, body: null } });
    expect(outcome.tests).toEqual([{ name: 't', passed: true, message: '' }]);
  });

  it('rejects messages that are not results', () => {
    for (const bad of [null, 'x', 5, [], {}, { type: 'other' }]) {
      expect(readScriptOutcome(bad, fallback)).toMatchObject({ ok: false, error: 'The script returned an unexpected result.', env: fallback });
    }
  });

  it('reports script errors and keeps whatever else was returned', () => {
    expect(readScriptOutcome({ type: 'result', error: 'boom', logs: [], tests: [], env: { a: '1' }, request: null }, fallback)).toMatchObject({ ok: false, error: 'boom', env: { a: '1' } });
  });

  it('drops values of the wrong type and enforces limits', () => {
    const outcome = readScriptOutcome(
      {
        type: 'result', error: null,
        logs: ['ok', 5, null, 'x'.repeat(5000)],
        tests: [{ name: 5, passed: 'yes', message: 3 }, 'junk', { name: 'good', passed: true }],
        env: { a: 'ok', b: 7, c: { nested: 1 }, '': 'empty key', ['k'.repeat(300)]: 'long key', long: 'v'.repeat(50_000) },
        request: null,
      },
      fallback,
    );
    expect(outcome.logs).toHaveLength(2); // non-strings are dropped
    expect(outcome.logs[1]).toHaveLength(2000);
    expect(outcome.tests).toEqual([{ name: 'test', passed: false, message: '' }, { name: 'good', passed: true, message: '' }]);
    expect(Object.keys(outcome.env).sort()).toEqual(['a', 'long']);
    expect(outcome.env['long']).toHaveLength(20_000);
  });

  it('does not let environment names reach the prototype', () => {
    const outcome = readScriptOutcome({ type: 'result', error: null, logs: [], tests: [], env: JSON.parse('{"__proto__": "x", "ok": "1"}'), request: null }, fallback);
    expect(Object.getPrototypeOf(outcome.env)).toBe(null);
    expect(({} as Record<string, unknown>)['x']).toBeUndefined();
  });

  it('uses the previous variables when the script returned none', () => {
    expect(readScriptOutcome({ type: 'result', error: null, logs: [], tests: [], env: 'nope', request: null }, fallback).env).toEqual(fallback);
  });

  it('reads a script request only when it still looks like one', () => {
    expect(readScriptRequest({ method: 'GET', url: 'u', headers: { A: 'b', n: 5 }, body: 7 })).toEqual({ method: 'GET', url: 'u', headers: { A: 'b' }, body: null });
    expect(readScriptRequest({ method: 5, url: 'u' })).toBeNull();
    expect(readScriptRequest(null)).toBeNull();
  });
});
