import { Injectable, computed, inject } from '@angular/core';
import { CollectionStore } from './collection-store.service';
import { EnvironmentStore } from './environment-store.service';
import { SavedRequestStore } from './saved-request-store.service';
import { SettingsStore } from './settings-store.service';

/** Collects storage problems reported by every persisted store so the UI can show them in one place. */
@Injectable({ providedIn: 'root' })
export class StorageHealth {
  private readonly stores = [
    inject(CollectionStore),
    inject(SavedRequestStore),
    inject(EnvironmentStore),
    inject(SettingsStore),
  ] as const;

  /** Distinct, user-facing messages about storage failures. Empty when everything is fine. */
  readonly problems = computed<readonly string[]>(() => [
    ...new Set(this.stores.map((store) => store.error()).filter((message): message is string => message !== null)),
  ]);

  clear(): void {
    for (const store of this.stores) store.clearError();
  }
}
