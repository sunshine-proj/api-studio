import { Injectable, computed, signal } from '@angular/core';
import { Environment, EnvironmentVariable, SCHEMA_VERSION } from '../models';
import { newId } from '../utils/id';
import { VariableMap } from '../utils/variable.util';

/** In-memory environments. Persistence is added with the database (Milestone 3). */
@Injectable({ providedIn: 'root' })
export class EnvironmentStore {
  private readonly environmentsState = signal<readonly Environment[]>([]);
  private readonly activeIdState = signal<string | null>(null);

  readonly environments = this.environmentsState.asReadonly();
  readonly activeId = this.activeIdState.asReadonly();
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

  create(name: string): Environment {
    const now = Date.now();
    const environment: Environment = {
      id: newId(),
      schemaVersion: SCHEMA_VERSION,
      createdAt: now,
      updatedAt: now,
      name: name.trim() || 'New environment',
      variables: [],
    };
    this.environmentsState.update((list) => [...list, environment]);
    return environment;
  }

  rename(id: string, name: string): void {
    this.patch(id, { name: name.trim() || 'Untitled' });
  }

  setVariables(id: string, variables: readonly EnvironmentVariable[]): void {
    this.patch(id, { variables });
  }

  remove(id: string): void {
    this.environmentsState.update((list) => list.filter((env) => env.id !== id));
    if (this.activeIdState() === id) {
      this.activeIdState.set(null);
    }
  }

  setActive(id: string | null): void {
    if (id === null || this.environments().some((env) => env.id === id)) {
      this.activeIdState.set(id);
    }
  }

  private patch(id: string, changes: Partial<Pick<Environment, 'name' | 'variables'>>): void {
    this.environmentsState.update((list) =>
      list.map((env) => (env.id === id ? { ...env, ...changes, updatedAt: Date.now() } : env)),
    );
  }
}
