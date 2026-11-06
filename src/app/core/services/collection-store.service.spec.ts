import { TestBed } from '@angular/core/testing';
import { ApiStudioDatabase, DATABASE_NAME, DatabaseService } from '../database/database.service';
import { CollectionStore } from './collection-store.service';

let counter = 0;

describe('CollectionStore', () => {
  let dbName: string;

  function setup(): CollectionStore {
    TestBed.configureTestingModule({ providers: [{ provide: DATABASE_NAME, useValue: dbName }] });
    return TestBed.inject(CollectionStore);
  }

  beforeEach(() => {
    dbName = `test-db-${++counter}`;
  });

  afterEach(async () => {
    TestBed.resetTestingModule();
    await new ApiStudioDatabase(dbName).delete();
  });

  it('creates, renames and nests collections and folders', async () => {
    const store = setup();
    await store.ready;

    const api = await store.createCollection('  Payments API ');
    const users = await store.createCollection('Users');
    expect(api?.name).toBe('Payments API');
    expect(users?.sortOrder).toBe(1);

    const v1 = await store.createFolder(api!.id, null, 'v1');
    const orders = await store.createFolder(api!.id, v1!.id, 'orders');
    await store.renameFolder(orders!.id, 'Orders');
    await store.renameCollection(users!.id, 'People');

    const tree = store.tree();
    expect(tree.map((n) => n.collection.name)).toEqual(['Payments API', 'People']);
    expect(tree[0].folders[0].children[0].folder.name).toBe('Orders');
    expect(store.error()).toBeNull();
  });

  it('persists to IndexedDB so data survives a reload', async () => {
    const first = setup();
    await first.ready;
    const collection = await first.createCollection('Kept');
    await first.createFolder(collection!.id, null, 'Inbox');

    TestBed.resetTestingModule(); // closes the connection, like leaving the page
    const second = setup();
    await second.ready;
    expect(second.collections().map((c) => c.name)).toEqual(['Kept']);
    expect(second.folders().map((f) => f.name)).toEqual(['Inbox']);
    expect(second.tree()[0].folders[0].folder.name).toBe('Inbox');
  });

  it('deletes a folder with its subfolders but keeps siblings', async () => {
    const store = setup();
    await store.ready;
    const c = (await store.createCollection('C'))!;
    const a = (await store.createFolder(c.id, null, 'a'))!;
    await store.createFolder(c.id, a.id, 'a1');
    await store.createFolder(c.id, null, 'b');

    await store.deleteFolder(a.id);
    expect(store.folders().map((f) => f.name)).toEqual(['b']);
    expect(await TestBed.inject(DatabaseService).folders.count()).toBe(1);
  });

  it('deletes a collection with all its folders and leaves other collections alone', async () => {
    const store = setup();
    await store.ready;
    const one = (await store.createCollection('One'))!;
    const two = (await store.createCollection('Two'))!;
    await store.createFolder(one.id, null, 'x');
    await store.createFolder(two.id, null, 'y');

    await store.deleteCollection(one.id);
    expect(store.collections().map((c) => c.name)).toEqual(['Two']);
    expect(store.folders().map((f) => f.name)).toEqual(['y']);
    const db = TestBed.inject(DatabaseService);
    expect([await db.collections.count(), await db.folders.count()]).toEqual([1, 1]);
  });

  it('refuses folders in a missing collection or a parent from another collection', async () => {
    const store = setup();
    await store.ready;
    const one = (await store.createCollection('One'))!;
    const two = (await store.createCollection('Two'))!;
    const inOne = (await store.createFolder(one.id, null, 'x'))!;

    expect(await store.createFolder('missing', null, 'f')).toBeNull();
    expect(await store.createFolder(two.id, inOne.id, 'f')).toBeNull();
    expect(store.error()).toContain('no longer exists');
    expect(store.folders()).toHaveLength(1);
  });

  it('keeps the screen unchanged and reports an error when saving fails', async () => {
    const store = setup();
    await store.ready;
    const db = TestBed.inject(DatabaseService);
    vi.spyOn(db.collections, 'add').mockRejectedValue(Object.assign(new Error('full'), { name: 'QuotaExceededError' }));

    expect(await store.createCollection('Nope')).toBeNull();
    expect(store.collections()).toEqual([]);
    expect(store.error()).toContain('storage is full');
    store.clearError();
    expect(store.error()).toBeNull();
  });

  it('reports a load failure and still becomes ready', async () => {
    TestBed.configureTestingModule({ providers: [{ provide: DATABASE_NAME, useValue: dbName }] });
    const db = TestBed.inject(DatabaseService);
    vi.spyOn(db.collections, 'toArray').mockRejectedValue(new Error('blocked'));
    const store = TestBed.inject(CollectionStore);
    await store.ready;
    expect(store.loaded()).toBe(true);
    expect(store.error()).toContain('could not be loaded');
  });
});
