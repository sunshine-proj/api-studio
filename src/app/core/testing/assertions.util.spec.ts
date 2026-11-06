import { Assertion } from '../models';
import { evaluateAssertions } from './assertions.util';
import { ResponseSnapshot } from './response-snapshot.model';

const response = (over: Partial<ResponseSnapshot> = {}): ResponseSnapshot => ({
  status: 200,
  statusText: 'OK',
  headers: new Map([['content-type', 'application/json; charset=utf-8'], ['x-count', '3']]),
  bodyText: '{"id":42,"name":"Ann","tags":["a"],"price":9.50,"missing":null}',
  durationMs: 120.4,
  ...over,
});

let n = 0;
const a = (over: Partial<Assertion>): Assertion => ({ id: `a${++n}`, enabled: true, target: 'status', property: '', operator: 'equals', expected: '', ...over });
const run = (assertion: Partial<Assertion>, snapshot = response(), vars = new Map<string, string>()) =>
  evaluateAssertions([a(assertion)], snapshot, vars)[0];

describe('assertions', () => {
  it('checks the status code', () => {
    expect(run({ target: 'status', operator: 'equals', expected: '200' }).passed).toBe(true);
    expect(run({ target: 'status', operator: 'equals', expected: '404' })).toMatchObject({ passed: false, message: 'Actual: 200' });
    expect(run({ target: 'status', operator: 'less-than', expected: '300' }).passed).toBe(true);
    expect(run({ target: 'status', operator: 'greater-than', expected: '300' }).passed).toBe(false);
    expect(run({ target: 'status', operator: 'not-equals', expected: '500' }).passed).toBe(true);
  });

  it('checks headers case-insensitively', () => {
    expect(run({ target: 'header', property: 'Content-Type', operator: 'contains', expected: 'json' }).passed).toBe(true);
    expect(run({ target: 'header', property: 'X-COUNT', operator: 'equals', expected: '3' }).passed).toBe(true);
    expect(run({ target: 'header', property: 'x-missing', operator: 'exists' }).passed).toBe(false);
    expect(run({ target: 'header', property: 'x-missing', operator: 'not-exists' }).passed).toBe(true);
    expect(run({ target: 'header', property: '', operator: 'exists' })).toMatchObject({ passed: false, message: 'No header name was given.' });
  });

  it('checks JSON values by path, comparing numbers numerically', () => {
    expect(run({ target: 'json', property: '$.id', operator: 'equals', expected: '42' }).passed).toBe(true);
    expect(run({ target: 'json', property: '$.price', operator: 'equals', expected: '9.5' }).passed).toBe(true);
    expect(run({ target: 'json', property: '$.name', operator: 'equals', expected: 'Ann' }).passed).toBe(true);
    expect(run({ target: 'json', property: '$.tags[0]', operator: 'equals', expected: 'a' }).passed).toBe(true);
    expect(run({ target: 'json', property: '$.price', operator: 'greater-than', expected: '9' }).passed).toBe(true);
    expect(run({ target: 'json', property: '$.nope', operator: 'exists' }).passed).toBe(false);
    expect(run({ target: 'json', property: '$.missing', operator: 'exists' }).passed).toBe(true); // null is present
    expect(run({ target: 'json', property: '$.tags', operator: 'contains', expected: '"a"' }).passed).toBe(true);
  });

  it('explains why a JSON check could not run', () => {
    expect(run({ target: 'json', property: '$.id', operator: 'equals', expected: '1' }, response({ bodyText: 'not json' })).message).toBe('The response body is not valid JSON.');
    expect(run({ target: 'json', property: '$.id', operator: 'equals', expected: '1' }, response({ bodyText: null })).message).toMatch(/not available/);
    expect(run({ target: 'json', property: '', operator: 'exists' }).message).toBe('No JSON path was given.');
  });

  it('checks the body and the duration', () => {
    expect(run({ target: 'body', operator: 'contains', expected: 'Ann' }).passed).toBe(true);
    expect(run({ target: 'body', operator: 'not-contains', expected: 'Bob' }).passed).toBe(true);
    expect(run({ target: 'body', operator: 'matches', expected: '"id":\\d+' }).passed).toBe(true);
    expect(run({ target: 'body', operator: 'exists' }, response({ bodyText: '' })).passed).toBe(false);
    expect(run({ target: 'duration', operator: 'less-than', expected: '500' }).passed).toBe(true);
    expect(run({ target: 'duration', operator: 'less-than', expected: '100' }).passed).toBe(false);
  });

  it('handles invalid regular expressions and non-numeric comparisons without throwing', () => {
    expect(run({ target: 'body', operator: 'matches', expected: '(' })).toMatchObject({ passed: false, message: expect.stringContaining('not a valid regular expression') });
    expect(run({ target: 'json', property: '$.name', operator: 'greater-than', expected: '1' })).toMatchObject({ passed: false, message: expect.stringContaining('must be numbers') });
  });

  it('resolves variables in the expected value, so a chain can be verified', () => {
    const vars = new Map([['userId', '42']]);
    expect(run({ target: 'json', property: '$.id', operator: 'equals', expected: '{{userId}}' }, response(), vars).passed).toBe(true);
    expect(run({ target: 'json', property: '$.id', operator: 'equals', expected: '{{other}}' }, response(), vars).passed).toBe(false);
  });

  it('skips disabled assertions and labels the rest', () => {
    const results = evaluateAssertions([a({ enabled: false }), a({ target: 'status', expected: '200' }), a({ target: 'json', property: '$.id', operator: 'exists' })], response());
    expect(results.map((r) => r.label)).toEqual(['status equals 200', 'JSON $.id exists']);
    expect(results.every((r) => r.source === 'assertion')).toBe(true);
  });
});
