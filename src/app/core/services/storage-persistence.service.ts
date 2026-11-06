import { Injectable, signal } from '@angular/core';

/**
 * - `checking`: not known yet.
 * - `persistent`: the browser promised not to delete the data when storage is low.
 * - `best-effort`: the browser may delete it (for example Safari after weeks of
 *   inactivity, or any browser under storage pressure).
 * - `unsupported`: the browser has no storage persistence API.
 */
export type PersistenceStatus = 'checking' | 'persistent' | 'best-effort' | 'unsupported';

export interface StorageUsage {
  readonly usedBytes: number;
  readonly quotaBytes: number;
}

/**
 * Asks the browser to keep the app's data (`navigator.storage.persist()`) and
 * reports whether it agreed. Checking never prompts. Requesting may show a
 * permission prompt (Firefox), so it should follow a user action.
 */
@Injectable({ providedIn: 'root' })
export class StoragePersistence {
  private readonly statusState = signal<PersistenceStatus>('checking');
  private readonly usageState = signal<StorageUsage | null>(null);

  readonly status = this.statusState.asReadonly();
  readonly usage = this.usageState.asReadonly();

  /** Reads the current state without asking for anything. */
  async check(): Promise<void> {
    const storage = this.storage();
    if (!storage || typeof storage.persisted !== 'function') {
      this.statusState.set('unsupported');
      return;
    }
    try {
      this.statusState.set((await storage.persisted()) ? 'persistent' : 'best-effort');
    } catch {
      this.statusState.set('best-effort');
    }
    await this.measure();
  }

  /** Asks the browser to make the data persistent. Resolves to true when it is. */
  async request(): Promise<boolean> {
    const storage = this.storage();
    if (!storage || typeof storage.persist !== 'function') {
      this.statusState.set('unsupported');
      return false;
    }
    try {
      const granted = (await storage.persisted?.()) === true || (await storage.persist());
      this.statusState.set(granted ? 'persistent' : 'best-effort');
      await this.measure();
      return granted;
    } catch {
      this.statusState.set('best-effort');
      return false;
    }
  }

  private async measure(): Promise<void> {
    try {
      const estimate = await this.storage()?.estimate?.();
      if (estimate?.usage !== undefined && estimate.quota !== undefined) {
        this.usageState.set({ usedBytes: estimate.usage, quotaBytes: estimate.quota });
      }
    } catch {
      // The estimate is informational only.
    }
  }

  private storage(): StorageManager | undefined {
    return typeof navigator === 'undefined' ? undefined : navigator.storage;
  }
}
