import { TestBed } from '@angular/core/testing';
import { ApiStudioDatabase, DATABASE_NAME, DatabaseService } from '../database/database.service';
import { ExecutionResult } from '../models';
import { createEmptyRequest } from '../utils/request-factory';
import { EnvironmentStore } from './environment-store.service';
import { HistoryStore } from './history-store.service';
import { SettingsStore } from './settings-store.service';

let counter = 0;

const ok = (status = 200): ExecutionResult =>
  ({ ok: true, response: { status, durationMs: 5 }, body: new Blob([]), request: {}, warnings: [] }) as unknown as ExecutionResult;
const definition = (url: string) => ({ ...createEmptyRequest(), url });

describe('HistoryStore', () => {
  let dbName: string;

  async function setup(): Promise<HistoryStore> {
    TestBed.configureTestingModule({ providers: [{ provide: DATABASE_NAME, useValue: dbName }] });
    const store = TestBed.inject(HistoryStore);
    await Promise.all([store.ready, TestBed.inject(SettingsStore).ready, TestBed.inject(EnvironmentStore).ready]);
    return store;
  }

  beforeEach(() => {
    dbName = `history-db-${++counter}`;
  });

  afterEach(async () => {
    TestBed.resetTestingModule();
    await new ApiStudioDatabase(dbName).delete();
  });

  it('records newest first and keeps entries after a reload', async () => {
    const first = await setup();
    await first.record(definition('https://a.test/1'), ok());
    await new Promise((r) => setTimeout(r, 2));
    await first.record(definition('https://a.test/2'), ok(404));
    expect(first.entries().map((e) => e.url)).toEqual(['https://a.test/2', 'https://a.test/1']);

    TestBed.resetTestingModule();
    const second = await setup();
    expect(second.entries().map((e) => [e.url, e.status])).toEqual([['https://a.test/2', 404], ['https://a.test/1', 200]]);
  });

  it('purges the oldest entries beyond the limit', async () => {
    const store = await setup();
    await TestBed.inject(SettingsStore).update({ historyLimit: 3 });
    for (let i = 1; i <= 5; i++) {
      await store.record(definition(`https://a.test/${i}`), ok());
      await new Promise((r) => setTimeout(r, 2));
    }
    expect(store.entries().map((e) => e.url)).toEqual(['https://a.test/5', 'https://a.test/4', 'https://a.test/3']);
    expect(await TestBed.inject(DatabaseService).history.count()).toBe(3);
  });

  it('purges immediately when the limit is lowered', async () => {
    const store = await setup();
    for (let i = 1; i <= 4; i++) {
      await store.record(definition(`https://a.test/${i}`), ok());
      await new Promise((r) => setTimeout(r, 2));
    }
    await TestBed.inject(SettingsStore).update({ historyLimit: 2 });
    await store.enforceLimit();
    expect(store.entries()).toHaveLength(2);
    expect(await TestBed.inject(DatabaseService).history.count()).toBe(2);
  });

  it('redacts Authorization and the values of secret variables before storing', async () => {
    const store = await setup();
    const environments = TestBed.inject(EnvironmentStore);
    const env = (await environments.create('Prod'))!;
    environments.setVariables(env.id, [{ id: '1', name: 'apiKey', value: 'sk-live-12345', enabled: true, secret: true }]);
    const request = {
      ...definition('https://a.test/?key=sk-live-12345'),
      headers: [{ id: 'h', key: 'Authorization', value: 'Bearer eyJhbGciOi', enabled: true }],
    };
    await store.record(request, ok());

    const stored = await TestBed.inject(DatabaseService).history.toArray();
    expect(stored[0].url).toBe('https://a.test/?key={{apiKey}}');
    expect(JSON.stringify(stored)).not.toMatch(/sk-live-12345|eyJhbGciOi/);
  });

  it('skips cancelled requests', async () => {
    const store = await setup();
    await store.record(definition('https://a.test'), { ok: false, error: { kind: 'aborted', message: 'c' }, request: null, durationMs: 0, warnings: [] });
    expect(store.entries()).toEqual([]);
  });

  it('removes one entry and clears all', async () => {
    const store = await setup();
    await store.record(definition('https://a.test/1'), ok());
    await new Promise((r) => setTimeout(r, 2));
    await store.record(definition('https://a.test/2'), ok());
    await store.remove(store.entries()[0].id);
    expect(store.entries().map((e) => e.url)).toEqual(['https://a.test/1']);
    await store.clear();
    expect(store.entries()).toEqual([]);
    expect(await TestBed.inject(DatabaseService).history.count()).toBe(0);
  });

  it('reports a storage failure without changing the list', async () => {
    const store = await setup();
    await store.record(definition('https://a.test/1'), ok());
    vi.spyOn(TestBed.inject(DatabaseService), 'transaction').mockRejectedValue(
      Object.assign(new Error('full'), { name: 'QuotaExceededError' }),
    );
    await store.record(definition('https://a.test/2'), ok());
    expect(store.entries()).toHaveLength(1);
    expect(store.error()).toContain('storage is full');
  });
});
