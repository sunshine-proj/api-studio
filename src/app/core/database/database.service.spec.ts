import Dexie from 'dexie';
import { ApiStudioDatabase } from './database.service';

let counter = 0;

/** Builds a database exactly as an older release of the app created it. */
async function createOldDatabase(
  name: string,
  version: number,
  stores: Record<string, string>,
  seed: (db: Dexie) => Promise<void>,
): Promise<void> {
  const old = new Dexie(name);
  old.version(version).stores(stores);
  await seed(old);
  old.close();
}

const V1_STORES = { collections: 'id, sortOrder', folders: 'id, collectionId, parentId' };
const V2_STORES = { ...V1_STORES, requests: 'id, collectionId, folderId' };

const collection = { id: 'c1', schemaVersion: 1, createdAt: 1, updatedAt: 1, name: 'Old', description: '', sortOrder: 0 };
const folder = { id: 'f1', schemaVersion: 1, createdAt: 1, updatedAt: 1, name: 'Dir', collectionId: 'c1', parentId: null, sortOrder: 0 };
const request = {
  id: 'r1',
  schemaVersion: 1,
  createdAt: 1,
  updatedAt: 1,
  name: 'GET /x',
  collectionId: 'c1',
  folderId: 'f1',
  sortOrder: 0,
  definition: { method: 'GET', url: 'https://a.test/x' },
};

describe('ApiStudioDatabase', () => {
  let name: string;
  let db: ApiStudioDatabase | undefined;

  beforeEach(() => {
    name = `migration-db-${++counter}`;
    db = undefined;
  });

  afterEach(async () => {
    db?.close();
    await Dexie.delete(name);
  });

  it('creates every table on a fresh install', async () => {
    db = new ApiStudioDatabase(name);
    await db.open();
    expect(db.tables.map((t) => t.name).sort()).toEqual(['collections', 'environments', 'folders', 'requests', 'settings']);
    expect(db.verno).toBe(3);
  });

  it('upgrades version 1 to the current version without losing data', async () => {
    await createOldDatabase(name, 1, V1_STORES, async (old) => {
      await old.table('collections').add(collection);
      await old.table('folders').add(folder);
    });

    db = new ApiStudioDatabase(name);
    await db.open();
    expect(await db.collections.toArray()).toEqual([collection]);
    expect(await db.folders.toArray()).toEqual([folder]);
    expect(await db.requests.count()).toBe(0);
    expect(await db.environments.count()).toBe(0);
    expect(await db.settings.count()).toBe(0);
  });

  it('upgrades version 2 to the current version without losing data', async () => {
    await createOldDatabase(name, 2, V2_STORES, async (old) => {
      await old.table('collections').add(collection);
      await old.table('folders').add(folder);
      await old.table('requests').add(request);
    });

    db = new ApiStudioDatabase(name);
    await db.open();
    expect(await db.requests.toArray()).toEqual([request]);
    expect(await db.requests.where('folderId').equals('f1').count()).toBe(1);
    expect(await db.collections.count()).toBe(1);
    expect(await db.environments.count()).toBe(0);
  });

  it('keeps the new tables usable after an upgrade, with their indexes', async () => {
    await createOldDatabase(name, 2, V2_STORES, async () => undefined);
    db = new ApiStudioDatabase(name);
    await db.environments.bulkAdd([
      { id: 'e2', schemaVersion: 1, createdAt: 2, updatedAt: 2, name: 'B', variables: [] },
      { id: 'e1', schemaVersion: 1, createdAt: 1, updatedAt: 1, name: 'A', variables: [] },
    ]);
    expect((await db.environments.orderBy('createdAt').toArray()).map((e) => e.id)).toEqual(['e1', 'e2']);
  });

  it('can be reopened at the same version without changes', async () => {
    db = new ApiStudioDatabase(name);
    await db.collections.add(collection);
    db.close();
    db = new ApiStudioDatabase(name);
    expect(await db.collections.count()).toBe(1);
  });
});
