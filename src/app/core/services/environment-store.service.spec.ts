import { TestBed } from '@angular/core/testing';
import { EnvironmentStore } from './environment-store.service';

describe('EnvironmentStore', () => {
  let store: EnvironmentStore;
  beforeEach(() => {
    store = TestBed.inject(EnvironmentStore);
  });

  it('exposes only enabled, named variables of the active environment', () => {
    const env = store.create('Dev');
    store.setVariables(env.id, [
      { id: '1', name: 'a', value: '1', enabled: true, secret: false },
      { id: '2', name: 'b', value: '2', enabled: false, secret: false },
      { id: '3', name: '', value: '3', enabled: true, secret: false },
    ]);
    expect(store.variables().size).toBe(0);
    store.setActive(env.id);
    expect([...store.variables()]).toEqual([['a', '1']]);
  });

  it('clears the active environment when it is removed and ignores unknown ids', () => {
    const env = store.create('Dev');
    store.setActive(env.id);
    store.setActive('missing');
    expect(store.activeId()).toBe(env.id);
    store.remove(env.id);
    expect(store.activeId()).toBeNull();
  });

  it('renames with a fallback for blank names', () => {
    const env = store.create('Dev');
    store.rename(env.id, '  ');
    expect(store.environments()[0].name).toBe('Untitled');
  });
});
