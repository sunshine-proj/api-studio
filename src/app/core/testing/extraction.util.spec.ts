import { Extraction } from '../models';
import { MAX_EXTRACTED_CHARS, isValidVariableName, runExtractions } from './extraction.util';
import { ResponseSnapshot } from './response-snapshot.model';

const response: ResponseSnapshot = {
  status: 201,
  statusText: 'Created',
  headers: new Map([['location', '/users/9'], ['set-token', 'abc']]),
  bodyText: '{"data":{"id":9,"token":"tok-1"},"html":"<b id=\\"x7\\">"}',
  durationMs: 10,
};

let n = 0;
const x = (over: Partial<Extraction>): Extraction => ({ id: `x${++n}`, enabled: true, variable: 'v', source: 'json', expression: '', secret: false, ...over });
const one = (over: Partial<Extraction>, snapshot = response) => runExtractions([x(over)], snapshot)[0];

describe('extractions', () => {
  it('reads JSON values, as text', () => {
    expect(one({ source: 'json', expression: '$.data.id' })).toMatchObject({ ok: true, value: '9', variable: 'v' });
    expect(one({ source: 'json', expression: '$.data' })).toMatchObject({ ok: true, value: '{"id":9,"token":"tok-1"}' });
  });

  it('reads headers case-insensitively and the status', () => {
    expect(one({ source: 'header', expression: 'Location' })).toMatchObject({ ok: true, value: '/users/9' });
    expect(one({ source: 'status' })).toMatchObject({ ok: true, value: '201' });
  });

  it('reads the first group of a regular expression, or the whole match', () => {
    expect(one({ source: 'regex', expression: 'tok-(\\d)' })).toMatchObject({ ok: true, value: '1' });
    expect(one({ source: 'regex', expression: 'tok-\\d' })).toMatchObject({ ok: true, value: 'tok-1' });
  });

  it('reports what went wrong instead of throwing', () => {
    expect(one({ source: 'json', expression: '$.nope' })).toMatchObject({ ok: false, message: 'Nothing found at $.nope.' });
    expect(one({ source: 'header', expression: 'x-none' }).ok).toBe(false);
    expect(one({ source: 'regex', expression: 'zzz' }).message).toMatch(/did not match/);
    expect(one({ source: 'regex', expression: '(' }).message).toMatch(/not a valid regular expression/);
    expect(one({ source: 'json', expression: '$.a' }, { ...response, bodyText: 'x' }).message).toMatch(/not valid JSON/);
    expect(one({ source: 'json', expression: '$.a' }, { ...response, bodyText: null }).message).toMatch(/not available/);
  });

  it('rejects unusable variable names', () => {
    for (const variable of ['', ' ', 'a b', '{{x}}', 'a{b']) {
      expect(one({ variable, source: 'status' }).ok).toBe(false);
    }
    expect(isValidVariableName('user_id')).toBe(true);
    expect(isValidVariableName('user.id')).toBe(true);
  });

  it('skips disabled rows, keeps the secret flag, and caps very long values', () => {
    expect(runExtractions([x({ enabled: false, source: 'status' })], response)).toEqual([]);
    expect(one({ source: 'status', secret: true }).secret).toBe(true);
    const long = one({ source: 'regex', expression: '.+' }, { ...response, bodyText: 'a'.repeat(MAX_EXTRACTED_CHARS + 50) });
    expect(long.value).toHaveLength(MAX_EXTRACTED_CHARS);
  });
});
