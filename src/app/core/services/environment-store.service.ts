import { Injectable, computed, inject, signal } from '@angular/core';
import { DatabaseService } from '../database/database.service';
import { Environment, EnvironmentVariable, SCHEMA_VERSION } from '../models';
import { newId } from '../utils/id';
import { describeStorageError } from '../utils/storage-error.util';
import { VariableMap } from '../utils/variable.util';
import { SettingsStore } from './settings-store.service';

const MAX_NAME_LENGTH = 120;

/**
 * Environments, persisted in IndexedDB. The active environment is part of the
 * settings record.
 *
 * Creating and deleting write to the database first. Renames and variable edits
 * happen on every keystroke, so they update the screen immediately and are
 * saved in order in the background; if saving fails the error signal says so.
 */
@Injectable({ providedIn: 'root' })
export class EnvironmentStore {
  private readonly db = inject(DatabaseService);
  private readonly settings = inject(SettingsStore);
  private readonly environmentsState = signal<readonly Environment[]>([]);
  private readonly loadedState = signal(false);
  private readonly errorState = signal<string | null>(null);
  private writes: Promise<unknown> = Promise.resolve();

  readonly environments = this.environmentsState.asReadonly();
  readonly loaded = this.loadedState.asReadonly();
  readonly error = this.errorState.asReadonly();
  /** The active environment id; null when none is chosen or the chosen one no longer exists. */
  readonly activeId = computed(() => {
    const id = this.settings.settings().activeEnvironmentId;
    return id !== null && this.environments().some((env) => env.id === id) ? id : null;
  });
  readonly active = computed(() => this.environments().find((env) => env.id === this.activeId()) ?? null);

  /** Enabled, named variables of the active environment. */
  readonly variables = computed<VariableMap>(() => {
    const map = new Map<string, string>();
    for (const variable of this.active()?.variables ?? []) {
      if (variable.enabled && variable.name !== '') {
        map.set(variable.name, variable.value);
      }
    }
    return map;
  });

  readonly ready: Promise<void> = this.load();

  /** Reads everything from the database again, e.g. after an import wrote to it directly. */
  reload(): Promise<void> {
    return this.load();
  }

  clearError(): void {
    this.errorState.set(null);
  }

  /** Resolves when every background save started so far has finished. */
  async whenSaved(): Promise<void> {
    await this.writes;
  }

  async create(name: string): Promise<Environment | null> {
    // Environments are listed by creation time, so two created in the same millisecond must not tie.
    const newest = this.environments().reduce((max, env) => Math.max(max, env.createdAt), 0);
    const now = Math.max(Date.now(), newest + 1);
    const environment: Environment = {
      id: newId(),
      schemaVersion: SCHEMA_VERSION,
      createdAt: now,
      updatedAt: now,
      name: name.trim().slice(0, MAX_NAME_LENGTH) || 'New environment',
      variables: [],
    };
    try {
      this.errorState.set(null);
      await this.db.environments.add(environment);
      this.environmentsState.update((list) => [...list, environment]);
      return environment;
    } catch (error) {
      this.errorState.set(describeStorageError(error, 'save'));
      return null;
    }
  }

  rename(id: string, name: string): void {
    this.patch(id, { name: name.trim().slice(0, MAX_NAME_LENGTH) || 'Untitled' });
  }

  setVariables(id: string, variables: readonly EnvironmentVariable[]): void {
    this.patch(id, { variables });
  }

  async remove(id: string): Promise<void> {
    try {
      this.errorState.set(null);
      await this.writes; // let pending edits land before the row disappears
      await this.db.environments.delete(id);
      this.environmentsState.update((list) => list.filter((env) => env.id !== id));
      if (this.settings.settings().activeEnvironmentId === id) {
        await this.settings.update({ activeEnvironmentId: null });
      }
    } catch (error) {
      this.errorState.set(describeStorageError(error, 'save'));
    }
  }

  /** Switches the active environment (null for none). Unknown ids are ignored. */
  async setActive(id: string | null): Promise<void> {
    if (id === null || this.environments().some((env) => env.id === id)) {
      await this.settings.update({ activeEnvironmentId: id });
    }
  }

  private patch(id: string, changes: Partial<Pick<Environment, 'name' | 'variables'>>): void {
    if (!this.environments().some((env) => env.id === id)) return;
    const updatedAt = Date.now();
    this.environmentsState.update((list) => list.map((env) => (env.id === id ? { ...env, ...changes, updatedAt } : env)));
    this.writes = this.writes.then(async () => {
      const latest = this.environments().find((env) => env.id === id);
      if (!latest) return; // deleted meanwhile
      try {
        await this.db.environments.put(latest);
      } catch (error) {
        this.errorState.set(describeStorageError(error, 'save'));
      }
    });
  }

  private async load(): Promise<void> {
    try {
      this.environmentsState.set(await this.db.environments.orderBy('createdAt').toArray());
    } catch (error) {
      this.errorState.set(describeStorageError(error, 'load'));
    } finally {
      this.loadedState.set(true);
    }
  }
}
