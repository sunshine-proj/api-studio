import { TestBed } from '@angular/core/testing';
import { ApiStudioDatabase, DATABASE_NAME, DatabaseService } from '../database/database.service';
import { ImportError, MAX_IMPORT_BYTES } from '../import-export/safe-json.util';
import { createEmptyRequest } from '../utils/request-factory';
import { CollectionStore } from './collection-store.service';
import { EnvironmentStore } from './environment-store.service';
import { ImportExportService } from './import-export.service';
import { SavedRequestStore } from './saved-request-store.service';
import { SettingsStore } from './settings-store.service';

let counter = 0;

describe('ImportExportService', () => {
  let dbName: string;
  let service: ImportExportService;
  let collections: CollectionStore;
  let requests: SavedRequestStore;
  let environments: EnvironmentStore;

  async function setup(): Promise<void> {
    TestBed.configureTestingModule({ providers: [{ provide: DATABASE_NAME, useValue: dbName }] });
    service = TestBed.inject(ImportExportService);
    collections = TestBed.inject(CollectionStore);
    requests = TestBed.inject(SavedRequestStore);
    environments = TestBed.inject(EnvironmentStore);
    await Promise.all([collections.ready, requests.ready, environments.ready, TestBed.inject(SettingsStore).ready]);
  }

  /** A collection with a folder, two requests (one with literal credentials) and a secret variable. */
  async function seed(): Promise<{ collectionId: string }> {
    const collection = (await collections.createCollection('Orders'))!;
    const folder = (await collections.createFolder(collection.id, null, 'v1'))!;
    await requests.create('Plain', collection.id, null, { ...createEmptyRequest(), url: 'https://a.test/plain' });
    await requests.create('Secured', collection.id, folder.id, {
      ...createEmptyRequest(), method: 'POST', url: 'https://a.test/s?key=sk-live-0001',
      auth: { type: 'bearer', token: 'literal-token' },
    });
    const env = (await environments.create('Prod'))!;
    environments.setVariables(env.id, [
      { id: 'a', name: 'host', value: 'a.test', enabled: true, secret: false },
      { id: 'b', name: 'apiKey', value: 'sk-live-0001', enabled: true, secret: true },
    ]);
    await environments.whenSaved();
    return { collectionId: collection.id };
  }

  beforeEach(() => {
    dbName = `import-db-${++counter}`;
  });

  afterEach(async () => {
    TestBed.resetTestingModule();
    await new ApiStudioDatabase(dbName).delete();
  });

  it('exports and re-imports into the same app, adding copies without touching existing data', async () => {
    await setup();
    const { collectionId } = await seed();
    const file = service.exportNative({ collectionIds: [collectionId], includeEnvironments: true }, true);

    const preview = service.prepare(file.content);
    expect(preview.format).toBe('api-studio');
    expect(await service.commit(preview.bundle)).toEqual({ ok: true });

    expect(collections.collections().map((c) => c.name)).toEqual(['Orders', 'Orders']);
    expect(collections.collections().map((c) => c.sortOrder)).toEqual([0, 1]);
    expect(requests.requests()).toHaveLength(4);
    expect(environments.environments().map((e) => e.name)).toEqual(['Prod', 'Prod']);
    expect(new Set([...collections.collections().map((c) => c.id), ...requests.requests().map((r) => r.id)]).size).toBe(6);
    // The copy's requests live in the copy's collection and folder.
    const copy = collections.collections()[1];
    expect(requests.requests().filter((r) => r.collectionId === copy.id)).toHaveLength(2);
    const copyFolder = collections.folders().find((f) => f.collectionId === copy.id)!;
    expect(requests.requests().find((r) => r.collectionId === copy.id && r.name === 'Secured')?.folderId).toBe(copyFolder.id);
  });

  it('persists what it imports', async () => {
    await setup();
    const { collectionId } = await seed();
    const preview = service.prepare(service.exportNative({ collectionIds: [collectionId], includeEnvironments: false }, true).content);
    await service.commit(preview.bundle);
    const db = TestBed.inject(DatabaseService);
    expect([await db.collections.count(), await db.folders.count(), await db.requests.count()]).toEqual([2, 2, 4]);
  });

  it('leaves credentials and secret values out of an export unless asked', async () => {
    await setup();
    const { collectionId } = await seed();
    const selection = { collectionIds: [collectionId], includeEnvironments: true };
    const safe = service.exportNative(selection, false).content;
    expect(safe).not.toMatch(/literal-token|sk-live-0001/);
    expect(safe).toContain('key={{apiKey}}');
    const full = service.exportNative(selection, true).content;
    expect(full).toMatch(/literal-token/);
    expect(full).toMatch(/sk-live-0001/);
  });

  it('scrubs secrets from requests even when environments are not exported', async () => {
    await setup();
    const { collectionId } = await seed();
    const safe = service.exportNative({ collectionIds: [collectionId], includeEnvironments: false }, false).content;
    expect(safe).not.toContain('sk-live-0001');
    const postman = service.exportPostman(collectionId, false).content;
    expect(postman).not.toMatch(/literal-token|sk-live-0001/);
  });

  it('reports what an export would expose', async () => {
    await setup();
    const { collectionId } = await seed();
    expect(service.sensitivity({ collectionIds: [collectionId], includeEnvironments: true })).toEqual({ secretVariables: 1, requestsWithCredentials: 1 });
    expect(service.sensitivity({ collectionIds: [collectionId], includeEnvironments: false })).toEqual({ secretVariables: 0, requestsWithCredentials: 1 });
    expect(service.sensitivity({ collectionIds: [], includeEnvironments: true })).toEqual({ secretVariables: 1, requestsWithCredentials: 0 });
  });

  it('exports only the selected collections', async () => {
    await setup();
    const { collectionId } = await seed();
    await collections.createCollection('Other');
    const doc = JSON.parse(service.exportNative({ collectionIds: [collectionId], includeEnvironments: false }, false).content);
    expect(doc.collections.map((c: { name: string }) => c.name)).toEqual(['Orders']);
    expect(doc.environments).toEqual([]);
  });

  it('names export files and exports Postman with a safe file name', async () => {
    await setup();
    const { collectionId } = await seed();
    expect(service.exportNative({ collectionIds: [collectionId], includeEnvironments: false }, false, new Date('2026-03-04T10:00:00Z')).filename).toBe('api-studio-export-2026-03-04.json');
    await collections.renameCollection(collectionId, 'a/b: c');
    expect(service.exportPostman(collectionId, false).filename).toBe('a_b_ c.postman_collection.json');
  });

  it('detects Postman and OpenAPI files', async () => {
    await setup();
    const postman = service.prepare(JSON.stringify({ info: { name: 'P' }, item: [{ name: 'r', request: { method: 'GET', url: 'https://a.test' } }] }));
    expect(postman.format).toBe('postman');
    await service.commit(postman.bundle);
    const openapi = service.prepare(JSON.stringify({ openapi: '3.0.0', info: { title: 'O' }, paths: { '/x': { get: {} } } }));
    expect(openapi.format).toBe('openapi');
    await service.commit(openapi.bundle);
    expect(collections.collections().map((c) => c.name)).toEqual(['P', 'O']);
    expect(environments.environments().map((e) => e.name)).toEqual(['O environment']);
    expect(requests.requests().map((r) => r.definition.url).sort()).toEqual(['https://a.test', '{{baseUrl}}/x']);
  });

  it('rejects unknown, malformed and hostile files without changing anything', async () => {
    await setup();
    expect(() => service.prepare('{"hello":"world"}')).toThrow(/not a recognized format/);
    expect(() => service.prepare('not json')).toThrow(ImportError);
    expect(() => service.prepare('{"format":"api-studio","version":1,"__proto__":{"x":1}}')).toThrow(/forbidden key/);
    expect(() => service.prepare('{"format":"api-studio","version":1,"collections":[{"id":"c","constructor":{}}]}')).toThrow(/forbidden key/);
    expect(collections.collections()).toEqual([]);
  });

  it('refuses oversized files before reading them', async () => {
    await setup();
    const big = new File(['{}'], 'big.json');
    Object.defineProperty(big, 'size', { value: MAX_IMPORT_BYTES + 1 });
    const text = vi.spyOn(big, 'text');
    await expect(service.readFile(big)).rejects.toThrow(/import limit/);
    expect(text).not.toHaveBeenCalled();
  });

  it('reads a chosen file', async () => {
    await setup();
    const file = new File([JSON.stringify({ info: { name: 'F' }, item: [] })], 'c.json');
    expect((await service.readFile(file)).format).toBe('postman');
  });

  it('writes nothing when storing fails part-way, and reports it', async () => {
    await setup();
    const preview = service.prepare(
      JSON.stringify({ info: { name: 'P' }, item: [{ name: 'r', request: { method: 'GET', url: 'https://a.test' } }] }),
    );
    const db = TestBed.inject(DatabaseService);
    vi.spyOn(db.requests, 'bulkAdd').mockRejectedValue(Object.assign(new Error('full'), { name: 'QuotaExceededError' }));
    const result = await service.commit(preview.bundle);
    expect(result).toMatchObject({ ok: false });
    expect(result.ok === false && result.message).toContain('storage is full');
    expect(await db.collections.count()).toBe(0); // the transaction was rolled back
    expect(collections.collections()).toEqual([]);
  });
});
