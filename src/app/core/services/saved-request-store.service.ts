import { Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatabaseService } from '../database/database.service';
import { RequestDefinition, SavedRequest, SCHEMA_VERSION } from '../models';
import { buildCollectionTree, cleanName, nextSortOrder } from '../utils/collection-tree.util';
import { newId } from '../utils/id';
import { describeStorageError } from '../utils/storage-error.util';
import { CollectionStore } from './collection-store.service';

/**
 * Saved requests, persisted in IndexedDB. Like the collection store it writes
 * to the database first and updates the screen only when that succeeded.
 */
@Injectable({ providedIn: 'root' })
export class SavedRequestStore {
  private readonly db = inject(DatabaseService);
  private readonly collections = inject(CollectionStore);
  private readonly requestsState = signal<readonly SavedRequest[]>([]);
  private readonly loadedState = signal(false);
  private readonly errorState = signal<string | null>(null);

  readonly requests = this.requestsState.asReadonly();
  readonly loaded = this.loadedState.asReadonly();
  readonly error = this.errorState.asReadonly();
  /** Collections, folders and requests together, ready for display. */
  readonly tree = computed(() =>
    buildCollectionTree(this.collections.collections(), this.collections.folders(), this.requests()),
  );

  readonly ready: Promise<void> = this.load();

  /** Reads everything from the database again, e.g. after an import wrote to it directly. */
  reload(): Promise<void> {
    return this.load();
  }

  constructor() {
    // The collection store deletes the database rows; here the in-memory copy follows.
    this.collections.removals$.pipe(takeUntilDestroyed()).subscribe(({ collectionId, folderIds }) => {
      this.requestsState.update((list) =>
        list.filter((r) => r.collectionId !== collectionId && !(r.folderId !== null && folderIds.includes(r.folderId))),
      );
    });
  }

  clearError(): void {
    this.errorState.set(null);
  }

  find(id: string): SavedRequest | undefined {
    return this.requests().find((r) => r.id === id);
  }

  async create(
    name: string,
    collectionId: string,
    folderId: string | null,
    definition: RequestDefinition,
  ): Promise<SavedRequest | null> {
    if (!this.collections.isValidLocation(collectionId, folderId)) {
      this.errorState.set('That location no longer exists, so the request was not saved.');
      return null;
    }
    const now = Date.now();
    const request: SavedRequest = {
      id: newId(),
      schemaVersion: SCHEMA_VERSION,
      createdAt: now,
      updatedAt: now,
      name: cleanName(name, 'New request'),
      collectionId,
      folderId,
      sortOrder: this.nextOrderIn(collectionId, folderId),
      definition,
    };
    return this.add(request);
  }

  /** Replaces the stored definition of a request (the "Save" of an already saved request). */
  async updateDefinition(id: string, definition: RequestDefinition): Promise<boolean> {
    if (!this.find(id)) return false;
    return this.change(id, { definition });
  }

  async rename(id: string, name: string): Promise<void> {
    await this.change(id, { name: cleanName(name, 'Untitled request') });
  }

  /** Copies a request into the same location, placed after its siblings. */
  async duplicate(id: string): Promise<SavedRequest | null> {
    const original = this.find(id);
    if (!original) return null;
    const now = Date.now();
    return this.add({
      ...original,
      id: newId(),
      createdAt: now,
      updatedAt: now,
      name: cleanName(`${original.name} copy`, 'Request copy'),
      sortOrder: this.nextOrderIn(original.collectionId, original.folderId),
    });
  }

  async move(id: string, collectionId: string, folderId: string | null): Promise<boolean> {
    const request = this.find(id);
    if (!request) return false;
    if (!this.collections.isValidLocation(collectionId, folderId)) {
      this.errorState.set('That location no longer exists, so the request was not moved.');
      return false;
    }
    if (request.collectionId === collectionId && request.folderId === folderId) return true;
    return this.change(id, { collectionId, folderId, sortOrder: this.nextOrderIn(collectionId, folderId) });
  }

  async remove(id: string): Promise<void> {
    await this.persist(async () => {
      await this.db.requests.delete(id);
      this.requestsState.update((list) => list.filter((r) => r.id !== id));
      return true;
    });
  }

  private nextOrderIn(collectionId: string, folderId: string | null): number {
    return nextSortOrder(this.requests().filter((r) => r.collectionId === collectionId && r.folderId === folderId));
  }

  private async add(request: SavedRequest): Promise<SavedRequest | null> {
    return this.persist(async () => {
      await this.db.requests.add(request);
      this.requestsState.update((list) => [...list, request]);
      return request;
    });
  }

  private async change(
    id: string,
    changes: Partial<Pick<SavedRequest, 'name' | 'collectionId' | 'folderId' | 'sortOrder' | 'definition'>>,
  ): Promise<boolean> {
    const updatedAt = Date.now();
    const done = await this.persist(async () => {
      await this.db.requests.update(id, { ...changes, updatedAt });
      this.requestsState.update((list) => list.map((r) => (r.id === id ? { ...r, ...changes, updatedAt } : r)));
      return true;
    });
    return done === true;
  }

  private async load(): Promise<void> {
    try {
      this.requestsState.set(await this.db.requests.toArray());
    } catch (error) {
      this.errorState.set(describeStorageError(error, 'load'));
    } finally {
      this.loadedState.set(true);
    }
  }

  private async persist<T>(operation: () => Promise<T>): Promise<T | null> {
    try {
      this.errorState.set(null);
      return await operation();
    } catch (error) {
      this.errorState.set(describeStorageError(error, 'save'));
      return null;
    }
  }
}
