import { TestBed } from '@angular/core/testing';
import { ApiStudioDatabase, DATABASE_NAME, DatabaseService } from '../database/database.service';
import { SETTINGS_ID } from '../models';
import { SettingsStore } from './settings-store.service';

let counter = 0;

describe('SettingsStore', () => {
  let dbName: string;

  async function setup(): Promise<SettingsStore> {
    TestBed.configureTestingModule({ providers: [{ provide: DATABASE_NAME, useValue: dbName }] });
    const store = TestBed.inject(SettingsStore);
    await store.ready;
    return store;
  }

  beforeEach(() => {
    dbName = `settings-db-${++counter}`;
  });

  afterEach(async () => {
    TestBed.resetTestingModule();
    await new ApiStudioDatabase(dbName).delete();
  });

  it('starts with defaults', async () => {
    const store = await setup();
    expect(store.loaded()).toBe(true);
    expect(store.theme()).toBe('system');
    expect(store.settings().historyLimit).toBe(100);
  });

  it('persists changes across a reload', async () => {
    const first = await setup();
    expect(await first.update({ theme: 'dark', historyLimit: 20 })).toBe(true);

    TestBed.resetTestingModule();
    const second = await setup();
    expect(second.theme()).toBe('dark');
    expect(second.settings().historyLimit).toBe(20);
  });

  it('does not lose a change when two updates are issued without waiting', async () => {
    const store = await setup();
    await Promise.all([store.update({ theme: 'light' }), store.update({ storageNoticeAcknowledged: true })]);
    expect(store.theme()).toBe('light');
    expect(store.settings().storageNoticeAcknowledged).toBe(true);
    const stored = await TestBed.inject(DatabaseService).settings.get(SETTINGS_ID);
    expect(stored).toMatchObject({ theme: 'light', storageNoticeAcknowledged: true });
  });

  it('repairs a corrupt stored record instead of using it', async () => {
    TestBed.configureTestingModule({ providers: [{ provide: DATABASE_NAME, useValue: dbName }] });
    await TestBed.inject(DatabaseService).settings.put({ id: SETTINGS_ID, theme: 'neon', historyLimit: -4 } as never);
    TestBed.resetTestingModule();
    const store = await setup();
    expect(store.theme()).toBe('system');
    expect(store.settings().historyLimit).toBe(100);
  });

  it('keeps the old value and reports an error when saving fails', async () => {
    const store = await setup();
    vi.spyOn(TestBed.inject(DatabaseService).settings, 'put').mockRejectedValue(new Error('blocked'));
    expect(await store.update({ theme: 'dark' })).toBe(false);
    expect(store.theme()).toBe('system');
    expect(store.error()).toContain('could not be saved');
    store.clearError();
    expect(store.error()).toBeNull();
  });

  it('falls back to defaults and still becomes ready when loading fails', async () => {
    TestBed.configureTestingModule({ providers: [{ provide: DATABASE_NAME, useValue: dbName }] });
    vi.spyOn(TestBed.inject(DatabaseService).settings, 'get').mockRejectedValue(new Error('blocked'));
    const store = TestBed.inject(SettingsStore);
    await store.ready;
    expect(store.loaded()).toBe(true);
    expect(store.theme()).toBe('system');
    expect(store.error()).toContain('could not be loaded');
  });
});
