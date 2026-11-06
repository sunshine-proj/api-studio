import { TestBed } from '@angular/core/testing';
import { ApiStudioDatabase, DATABASE_NAME, DatabaseService } from '../database/database.service';
import { EnvironmentVariable } from '../models';
import { EnvironmentStore } from './environment-store.service';
import { SettingsStore } from './settings-store.service';

let counter = 0;

const variable = (id: string, over: Partial<EnvironmentVariable> = {}): EnvironmentVariable => ({
  id,
  name: id,
  value: '1',
  enabled: true,
  secret: false,
  ...over,
});

describe('EnvironmentStore', () => {
  let dbName: string;

  async function setup(): Promise<EnvironmentStore> {
    TestBed.configureTestingModule({ providers: [{ provide: DATABASE_NAME, useValue: dbName }] });
    const store = TestBed.inject(EnvironmentStore);
    await Promise.all([store.ready, TestBed.inject(SettingsStore).ready]);
    return store;
  }

  beforeEach(() => {
    dbName = `env-db-${++counter}`;
  });

  afterEach(async () => {
    TestBed.resetTestingModule();
    await new ApiStudioDatabase(dbName).delete();
  });

  it('exposes only enabled, named variables of the active environment', async () => {
    const store = await setup();
    const env = (await store.create('Dev'))!;
    store.setVariables(env.id, [
      variable('a'),
      variable('b', { value: '2', enabled: false }),
      variable('c', { name: '', value: '3' }),
    ]);
    expect(store.variables().size).toBe(0);
    await store.setActive(env.id);
    expect([...store.variables()]).toEqual([['a', '1']]);
  });

  it('clears the active environment when it is removed and ignores unknown ids', async () => {
    const store = await setup();
    const env = (await store.create('Dev'))!;
    await store.setActive(env.id);
    await store.setActive('missing');
    expect(store.activeId()).toBe(env.id);
    await store.remove(env.id);
    expect(store.activeId()).toBeNull();
    expect(TestBed.inject(SettingsStore).settings().activeEnvironmentId).toBeNull();
    expect(await TestBed.inject(DatabaseService).environments.count()).toBe(0);
  });

  it('renames with a fallback for blank names', async () => {
    const store = await setup();
    const env = (await store.create('Dev'))!;
    store.rename(env.id, '  ');
    expect(store.environments()[0].name).toBe('Untitled');
  });

  it('keeps environments, variables and the active choice after a reload', async () => {
    const first = await setup();
    const dev = (await first.create('Dev'))!;
    await first.create('Prod');
    first.setVariables(dev.id, [variable('token', { value: 's3cret', secret: true })]);
    first.rename(dev.id, 'Development');
    await first.setActive(dev.id);
    await first.whenSaved();

    TestBed.resetTestingModule(); // closes the connection, like leaving the page
    const second = await setup();
    expect(second.environments().map((e) => e.name)).toEqual(['Development', 'Prod']);
    expect(second.active()?.variables).toEqual([variable('token', { value: 's3cret', secret: true })]);
    expect(second.variables().get('token')).toBe('s3cret');
  });

  it('saves rapid edits in order so the last one wins', async () => {
    const store = await setup();
    const env = (await store.create('Dev'))!;
    for (const value of ['a', 'ab', 'abc']) store.setVariables(env.id, [variable('x', { value })]);
    await store.whenSaved();
    const stored = await TestBed.inject(DatabaseService).environments.get(env.id);
    expect(stored?.variables[0].value).toBe('abc');
  });

  it('ignores an active id that points at a missing environment', async () => {
    const store = await setup();
    await TestBed.inject(SettingsStore).update({ activeEnvironmentId: 'gone' });
    expect(store.activeId()).toBeNull();
    expect(store.active()).toBeNull();
  });

  it('reports a failed create without changing the list', async () => {
    const store = await setup();
    vi.spyOn(TestBed.inject(DatabaseService).environments, 'add').mockRejectedValue(
      Object.assign(new Error('full'), { name: 'QuotaExceededError' }),
    );
    expect(await store.create('Nope')).toBeNull();
    expect(store.environments()).toEqual([]);
    expect(store.error()).toContain('storage is full');
  });

  it('reports a failed background save', async () => {
    const store = await setup();
    const env = (await store.create('Dev'))!;
    vi.spyOn(TestBed.inject(DatabaseService).environments, 'put').mockRejectedValue(new Error('boom'));
    store.rename(env.id, 'Renamed');
    await store.whenSaved();
    expect(store.error()).toContain('could not be saved');
  });
});
