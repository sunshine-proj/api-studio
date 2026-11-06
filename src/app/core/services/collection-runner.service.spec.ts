import { TestBed } from '@angular/core/testing';
import { ApiStudioDatabase, DATABASE_NAME } from '../database/database.service';
import { ExecutionResult, ExecutionSuccess, RequestDefinition } from '../models';
import { OAuthPopup } from '../oauth/oauth-popup';
import { ScriptSandbox } from '../scripting/script-sandbox';
import { createEmptyRequest } from '../utils/request-factory';
import { CollectionRunner } from './collection-runner.service';
import { CollectionStore } from './collection-store.service';
import { EnvironmentStore } from './environment-store.service';
import { ExecutionContext, RequestExecutionService } from './request-execution.service';
import { SavedRequestStore } from './saved-request-store.service';
import { SettingsStore } from './settings-store.service';

let counter = 0;

function ok(status: number, body: string): ExecutionSuccess {
  return {
    ok: true,
    response: {
      status, statusText: '', headers: [{ name: 'content-type', value: 'application/json' }],
      body: { contentType: 'application/json', size: body.length, truncated: false },
      durationMs: 5, url: 'https://a.test/', redirected: false, cookies: { available: false, reason: '' },
    },
    body: new Blob([body]),
    request: { method: 'GET', url: 'https://a.test/', headers: [], body: { type: 'none' }, options: createEmptyRequest().options },
    warnings: [],
  };
}

/** Answers by URL so tests can describe a little API. */
class FakeApi extends RequestExecutionService {
  calls: { url: string; variables: ReadonlyMap<string, string> }[] = [];
  routes = new Map<string, () => ExecutionResult | Promise<ExecutionResult>>();
  execute(definition: RequestDefinition, context: ExecutionContext): Promise<ExecutionResult> {
    this.calls.push({ url: definition.url, variables: context.variables });
    const route = this.routes.get(definition.url);
    return Promise.resolve(route ? route() : ok(200, '{}'));
  }
}

describe('CollectionRunner', () => {
  let dbName: string;
  let api: FakeApi;
  let runner: CollectionRunner;
  let requests: SavedRequestStore;
  let collections: CollectionStore;
  let collectionId: string;

  const add = (name: string, over: Partial<RequestDefinition>, folderId: string | null = null) =>
    requests.create(name, collectionId, folderId, { ...createEmptyRequest(), url: `https://a.test/${name}`, ...over });

  beforeEach(async () => {
    dbName = `runner-db-${++counter}`;
    api = new FakeApi();
    TestBed.configureTestingModule({
      providers: [
        { provide: DATABASE_NAME, useValue: dbName },
        { provide: RequestExecutionService, useValue: api },
        { provide: ScriptSandbox, useValue: { run: () => Promise.reject(new Error('not used')) } },
        { provide: OAuthPopup, useValue: { open: () => Promise.reject(new Error('not used')) } },
      ],
    });
    runner = TestBed.inject(CollectionRunner);
    requests = TestBed.inject(SavedRequestStore);
    collections = TestBed.inject(CollectionStore);
    await Promise.all([requests.ready, collections.ready, TestBed.inject(EnvironmentStore).ready, TestBed.inject(SettingsStore).ready]);
    collectionId = (await collections.createCollection('API'))!.id;
  });

  afterEach(async () => {
    TestBed.resetTestingModule();
    await new ApiStudioDatabase(dbName).delete();
  });

  it('runs requests in sidebar order and reports each result', async () => {
    const folder = (await collections.createFolder(collectionId, null, 'f'))!;
    await add('root', {});
    await add('inFolder', {}, folder.id);
    api.routes.set('https://a.test/root', () => ok(404, '{}'));

    await runner.run({ collectionId, folderId: null }, { stopOnFailure: false });

    expect(api.calls.map((c) => c.url)).toEqual(['https://a.test/inFolder', 'https://a.test/root']);
    expect(runner.status()).toBe('done');
    expect(runner.items().map((i) => [i.name, i.status, i.passed])).toEqual([['inFolder', 200, true], ['root', 404, true]]);
    expect(runner.summary()).toMatchObject({ completed: 2, passed: 2, failed: 0 });
  });

  it('chains: a value extracted by one request is available to the next, even without an environment', async () => {
    await add('login', {
      extractions: [{ id: 'e', enabled: true, variable: 'sessionId', source: 'json', expression: '$.session', secret: false }],
    });
    await add('profile', { url: 'https://a.test/me/{{sessionId}}' });
    api.routes.set('https://a.test/login', () => ok(200, '{"session":"s-42"}'));

    await runner.run({ collectionId, folderId: null }, { stopOnFailure: false });

    const profile = api.calls.find((c) => c.url.includes('/me/'))!;
    expect(profile.variables.get('sessionId')).toBe('s-42');
    expect(runner.items()[0].extractions[0]).toMatchObject({ ok: true, value: 's-42' });
  });

  it('counts failed assertions and transport errors as failures', async () => {
    await add('a-fails', { assertions: [{ id: 'x', enabled: true, target: 'status', property: '', operator: 'equals', expected: '201' }] });
    await add('b-down', {});
    api.routes.set('https://a.test/b-down', () => ({ ok: false, error: { kind: 'network', message: 'unreachable' }, request: null, durationMs: 3, warnings: [] }));

    await runner.run({ collectionId, folderId: null }, { stopOnFailure: false });

    expect(runner.items().map((i) => [i.name, i.passed])).toEqual([['a-fails', false], ['b-down', false]]);
    expect(runner.items()[0].checks[0].message).toBe('Actual: 200');
    expect(runner.items()[1]).toMatchObject({ status: null, error: 'unreachable' });
    expect(runner.summary()).toMatchObject({ failed: 2, checks: 1, failedChecks: 1 });
  });

  it('can stop at the first failure', async () => {
    await add('first', { assertions: [{ id: 'x', enabled: true, target: 'status', property: '', operator: 'equals', expected: '500' }] });
    await add('second', {});
    await runner.run({ collectionId, folderId: null }, { stopOnFailure: true });
    expect(runner.items().map((i) => i.name)).toEqual(['first']);
    expect(runner.total()).toBe(2);
    expect(runner.status()).toBe('done');
  });

  it('runs only the chosen folder', async () => {
    const folder = (await collections.createFolder(collectionId, null, 'f'))!;
    await add('outside', {});
    await add('inside', {}, folder.id);
    await runner.run({ collectionId, folderId: folder.id }, { stopOnFailure: false });
    expect(runner.items().map((i) => i.name)).toEqual(['inside']);
  });

  it('can be cancelled, which stops after the current request', async () => {
    await add('one', {});
    await add('two', {});
    let release!: (r: ExecutionResult) => void;
    api.routes.set('https://a.test/one', () => new Promise<ExecutionResult>((resolve) => (release = resolve)));
    const running = runner.run({ collectionId, folderId: null }, { stopOnFailure: false });
    await new Promise((r) => setTimeout(r));
    expect(runner.running()).toBe(true);
    runner.cancel();
    release(ok(200, '{}'));
    await running;
    expect(runner.status()).toBe('cancelled');
    expect(api.calls.map((c) => c.url)).toEqual(['https://a.test/one']);
  });

  it('ignores a second run while one is going, and handles an empty scope', async () => {
    await runner.run({ collectionId: 'missing', folderId: null }, { stopOnFailure: false });
    expect(runner.items()).toEqual([]);
    expect(runner.status()).toBe('done');
    runner.reset();
    expect(runner.status()).toBe('idle');
  });

  it('records each request in the history', async () => {
    await add('logged', {});
    await runner.run({ collectionId, folderId: null }, { stopOnFailure: false });
    const { HistoryStore } = await import('./history-store.service');
    await TestBed.inject(HistoryStore).enforceLimit(); // waits for pending writes
    expect(TestBed.inject(HistoryStore).entries().map((e) => e.url)).toEqual(['https://a.test/logged']);
  });
});
