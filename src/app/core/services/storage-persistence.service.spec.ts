import { TestBed } from '@angular/core/testing';
import { StoragePersistence } from './storage-persistence.service';

function stubStorage(storage: Partial<StorageManager> | undefined): void {
  Object.defineProperty(navigator, 'storage', { value: storage, configurable: true });
}

describe('StoragePersistence', () => {
  afterEach(() => {
    // Remove the stub so other specs see the environment's own (missing) implementation.
    Reflect.deleteProperty(navigator, 'storage');
  });

  it('reports unsupported browsers honestly', async () => {
    stubStorage(undefined);
    const service = TestBed.inject(StoragePersistence);
    await service.check();
    expect(service.status()).toBe('unsupported');
    expect(await service.request()).toBe(false);
    expect(service.status()).toBe('unsupported');
  });

  it('checks without asking the browser for anything', async () => {
    const persist = vi.fn();
    stubStorage({
      persisted: () => Promise.resolve(false),
      persist,
      estimate: () => Promise.resolve({ usage: 10, quota: 100 }),
    });
    const service = TestBed.inject(StoragePersistence);
    expect(service.status()).toBe('checking');
    await service.check();
    expect(service.status()).toBe('best-effort');
    expect(service.usage()).toEqual({ usedBytes: 10, quotaBytes: 100 });
    expect(persist).not.toHaveBeenCalled();
  });

  it('becomes persistent when the browser grants the request', async () => {
    stubStorage({ persisted: () => Promise.resolve(false), persist: () => Promise.resolve(true) });
    const service = TestBed.inject(StoragePersistence);
    expect(await service.request()).toBe(true);
    expect(service.status()).toBe('persistent');
  });

  it('stays best-effort when the browser declines or throws', async () => {
    stubStorage({ persisted: () => Promise.resolve(false), persist: () => Promise.resolve(false) });
    const service = TestBed.inject(StoragePersistence);
    expect(await service.request()).toBe(false);
    expect(service.status()).toBe('best-effort');

    stubStorage({ persisted: () => Promise.resolve(false), persist: () => Promise.reject(new Error('denied')) });
    expect(await service.request()).toBe(false);
    expect(service.status()).toBe('best-effort');
  });

  it('does not ask again when the data is already persistent', async () => {
    const persist = vi.fn();
    stubStorage({ persisted: () => Promise.resolve(true), persist });
    const service = TestBed.inject(StoragePersistence);
    expect(await service.request()).toBe(true);
    expect(persist).not.toHaveBeenCalled();
  });
});
