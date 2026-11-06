import { Injectable, computed, inject, signal } from '@angular/core';
import { DatabaseService } from '../database/database.service';
import { ExecutionResult, HistoryEntry, RequestDefinition } from '../models';
import { createHistoryEntry } from '../utils/history.util';
import { newId } from '../utils/id';
import { SecretVariable } from '../utils/redaction.util';
import { describeStorageError } from '../utils/storage-error.util';
import { EnvironmentStore } from './environment-store.service';
import { SettingsStore } from './settings-store.service';

/**
 * Request history, newest first, persisted in IndexedDB. Entries are redacted
 * before they are stored (see `redactDefinition`), and the oldest are purged
 * once there are more than the configured limit.
 */
@Injectable({ providedIn: 'root' })
export class HistoryStore {
  private readonly db = inject(DatabaseService);
  private readonly environments = inject(EnvironmentStore);
  private readonly settings = inject(SettingsStore);
  private readonly entriesState = signal<readonly HistoryEntry[]>([]);
  private readonly loadedState = signal(false);
  private readonly errorState = signal<string | null>(null);
  /** Serializes writes so two finishing requests cannot race on the purge. */
  private queue: Promise<unknown> = Promise.resolve();

  readonly entries = this.entriesState.asReadonly();
  readonly loaded = this.loadedState.asReadonly();
  readonly error = this.errorState.asReadonly();

  /** Values of every variable marked secret, in any environment. */
  private readonly secrets = computed<readonly SecretVariable[]>(() =>
    this.environments
      .environments()
      .flatMap((env) => env.variables)
      .filter((variable) => variable.secret && variable.name !== '' && variable.value !== '')
      .map((variable) => ({ name: variable.name, value: variable.value })),
  );

  readonly ready: Promise<void> = this.load();

  clearError(): void {
    this.errorState.set(null);
  }

  /** Records an execution. Cancelled and never-sent requests are skipped. Resolves when stored. */
  record(definition: RequestDefinition, result: ExecutionResult): Promise<void> {
    const entry = createHistoryEntry(definition, result, this.secrets(), newId(), Date.now());
    if (entry === null) return Promise.resolve();
    return this.enqueue(async () => {
      const kept = [entry, ...this.entriesState()];
      const excess = kept.slice(this.limit()).map((e) => e.id);
      await this.db.transaction('rw', this.db.history, async () => {
        await this.db.history.add(entry);
        if (excess.length > 0) await this.db.history.bulkDelete(excess);
      });
      this.entriesState.set(kept.slice(0, this.limit()));
    });
  }

  /** Purges the oldest entries beyond the configured limit (call after lowering it). */
  enforceLimit(): Promise<void> {
    return this.enqueue(async () => {
      const excess = this.entriesState().slice(this.limit()).map((e) => e.id);
      if (excess.length === 0) return;
      await this.db.history.bulkDelete(excess);
      this.entriesState.update((list) => list.slice(0, this.limit()));
    });
  }

  remove(id: string): Promise<void> {
    return this.enqueue(async () => {
      await this.db.history.delete(id);
      this.entriesState.update((list) => list.filter((e) => e.id !== id));
    });
  }

  clear(): Promise<void> {
    return this.enqueue(async () => {
      await this.db.history.clear();
      this.entriesState.set([]);
    });
  }

  private limit(): number {
    return this.settings.settings().historyLimit;
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const run = this.queue.then(async () => {
      try {
        this.errorState.set(null);
        await operation();
      } catch (error) {
        this.errorState.set(describeStorageError(error, 'save'));
      }
    });
    this.queue = run;
    return run;
  }

  private async load(): Promise<void> {
    try {
      this.entriesState.set(await this.db.history.orderBy('executedAt').reverse().toArray());
    } catch (error) {
      this.errorState.set(describeStorageError(error, 'load'));
    } finally {
      this.loadedState.set(true);
    }
  }
}
