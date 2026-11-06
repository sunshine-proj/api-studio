import { Injectable, computed, inject, signal } from '@angular/core';
import { DatabaseService } from '../database/database.service';
import { AppSettings, SETTINGS_ID } from '../models';
import { createDefaultSettings, normalizeSettings } from '../utils/settings.util';
import { describeStorageError } from '../utils/storage-error.util';

export type SettingsChanges = Partial<Omit<AppSettings, 'id' | 'schemaVersion' | 'createdAt' | 'updatedAt'>>;

/**
 * Application settings, persisted as one record in IndexedDB. Until the record
 * has loaded (or when storage is unavailable) the defaults are used, so the app
 * stays usable without storage.
 */
@Injectable({ providedIn: 'root' })
export class SettingsStore {
  private readonly db = inject(DatabaseService);
  private readonly settingsState = signal<AppSettings>(createDefaultSettings());
  private readonly loadedState = signal(false);
  private readonly errorState = signal<string | null>(null);
  /** Serializes writes so two quick changes cannot overwrite each other. */
  private queue: Promise<unknown> = Promise.resolve();

  readonly settings = this.settingsState.asReadonly();
  readonly theme = computed(() => this.settings().theme);
  readonly loaded = this.loadedState.asReadonly();
  readonly error = this.errorState.asReadonly();

  readonly ready: Promise<void> = this.load();

  clearError(): void {
    this.errorState.set(null);
  }

  /** Saves the changes. The screen follows only once they are stored; resolves to false on failure. */
  update(changes: SettingsChanges): Promise<boolean> {
    const run = this.queue.then(() => this.write(changes));
    this.queue = run;
    return run;
  }

  private async write(changes: SettingsChanges): Promise<boolean> {
    try {
      this.errorState.set(null);
      const next = normalizeSettings({ ...this.settingsState(), ...changes, updatedAt: Date.now() });
      await this.db.settings.put(next);
      this.settingsState.set(next);
      return true;
    } catch (error) {
      this.errorState.set(describeStorageError(error, 'save'));
      return false;
    }
  }

  private async load(): Promise<void> {
    try {
      const stored = await this.db.settings.get(SETTINGS_ID);
      if (stored !== undefined) this.settingsState.set(normalizeSettings(stored));
    } catch (error) {
      this.errorState.set(describeStorageError(error, 'load'));
    } finally {
      this.loadedState.set(true);
    }
  }
}
