import { TestBed } from '@angular/core/testing';
import { ApiStudioDatabase, DATABASE_NAME, DatabaseService } from '../database/database.service';
import { CollectionStore } from './collection-store.service';
import { StorageHealth } from './storage-health.service';
import { SettingsStore } from './settings-store.service';

describe('StorageHealth', () => {
  const dbName = 'health-db';

  afterEach(async () => {
    TestBed.resetTestingModule();
    await new ApiStudioDatabase(dbName).delete();
  });

  it('collects each store\'s problem once and clears them all', async () => {
    TestBed.configureTestingModule({ providers: [{ provide: DATABASE_NAME, useValue: dbName }] });
    const db = TestBed.inject(DatabaseService);
    vi.spyOn(db.settings, 'put').mockRejectedValue(new Error('x'));
    vi.spyOn(db.collections, 'add').mockRejectedValue(new Error('x'));
    const health = TestBed.inject(StorageHealth);
    const collections = TestBed.inject(CollectionStore);
    const settings = TestBed.inject(SettingsStore);
    await Promise.all([collections.ready, settings.ready]);
    expect(health.problems()).toEqual([]);

    await collections.createCollection('A');
    await settings.update({ theme: 'dark' });
    // Both stores report the same wording, which is shown once.
    expect(health.problems()).toEqual(['The change could not be saved to browser storage and was not applied.']);

    health.clear();
    expect(health.problems()).toEqual([]);
  });
});
