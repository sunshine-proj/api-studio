import { ExecutionResult } from '../models';
import { createHistoryEntry } from './history.util';
import { createEmptyRequest } from './request-factory';

const definition = { ...createEmptyRequest(), method: 'POST', url: 'https://a.test/x' };
const base = { request: null, warnings: [] as string[] };

describe('createHistoryEntry', () => {
  it('records a response with status and duration', () => {
    const result = {
      ok: true,
      response: { status: 201, durationMs: 12 },
      body: new Blob([]),
      request: {},
      warnings: [],
    } as unknown as ExecutionResult;
    const entry = createHistoryEntry(definition, result, [], 'id-1', 1000);
    expect(entry).toMatchObject({ id: 'id-1', method: 'POST', url: 'https://a.test/x', status: 201, durationMs: 12, error: null, executedAt: 1000 });
  });

  it('records network and timeout failures with their error', () => {
    const error = { kind: 'timeout', message: 'slow' } as const;
    const entry = createHistoryEntry(definition, { ok: false, error, durationMs: 30000, ...base }, [], 'id-2', 5);
    expect(entry).toMatchObject({ status: null, durationMs: 30000, error });
  });

  it('skips cancelled and never-sent requests', () => {
    for (const kind of ['aborted', 'invalid-request'] as const) {
      expect(createHistoryEntry(definition, { ok: false, error: { kind, message: 'x' }, durationMs: null, ...base }, [], 'id', 1)).toBeNull();
    }
  });

  it('stores a redacted snapshot', () => {
    const secret = { ...definition, url: 'https://a.test/?k=topsecret1', headers: [{ id: '1', key: 'Authorization', value: 'Bearer real', enabled: true }] };
    const entry = createHistoryEntry(secret, { ok: false, error: { kind: 'network', message: 'x' }, durationMs: 1, ...base }, [{ name: 'k', value: 'topsecret1' }], 'id', 1)!;
    expect(entry.url).toBe('https://a.test/?k={{k}}');
    expect(JSON.stringify(entry)).not.toMatch(/topsecret1|Bearer real/);
  });

  it('flags a shortened body', () => {
    const big = { ...definition, body: { type: 'text' as const, language: 'text' as const, content: 'x'.repeat(300_000) } };
    const entry = createHistoryEntry(big, { ok: false, error: { kind: 'network', message: 'x' }, durationMs: 1, ...base }, [], 'id', 1)!;
    expect(entry.bodyTruncated).toBe(true);
  });
});
