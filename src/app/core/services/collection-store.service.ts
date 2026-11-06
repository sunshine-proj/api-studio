import { Injectable, computed, inject, signal } from '@angular/core';
import { Subject } from 'rxjs';
import { DatabaseService } from '../database/database.service';
import { Collection, Folder, SCHEMA_VERSION } from '../models';
import { buildCollectionTree, cleanName, folderSubtreeIds, nextSortOrder } from '../utils/collection-tree.util';
import { newId } from '../utils/id';
import { describeStorageError } from '../utils/storage-error.util';

/** Announces deleted collections/folders so stores holding their contents can drop them. */
export interface RemovalEvent {
  /** Set when a whole collection was removed. */
  readonly collectionId: string | null;
  readonly folderIds: readonly string[];
}

/**
 * Collections and folders, persisted in IndexedDB. Every change is written to
 * the database first and only then reflected in the signals, so a storage
 * failure never leaves the screen showing data that was not saved.
 */
@Injectable({ providedIn: 'root' })
export class CollectionStore {
  private readonly db = inject(DatabaseService);
  private readonly collectionsState = signal<readonly Collection[]>([]);
  private readonly foldersState = signal<readonly Folder[]>([]);
  private readonly loadedState = signal(false);
  private readonly errorState = signal<string | null>(null);

  readonly collections = this.collectionsState.asReadonly();
  readonly folders = this.foldersState.asReadonly();
  readonly loaded = this.loadedState.asReadonly();
  /** User-facing message about the last storage problem, or null. */
  readonly error = this.errorState.asReadonly();
  /** Emits after collections or folders (and the requests inside them) were deleted. */
  readonly removals$ = new Subject<RemovalEvent>();
  readonly tree = computed(() => buildCollectionTree(this.collections(), this.folders()));

  /** Settles when the initial load is done, whether it worked or not. */
  readonly ready: Promise<void> = this.load();

  /** Reads everything from the database again, e.g. after an import wrote to it directly. */
  reload(): Promise<void> {
    return this.load();
  }

  clearError(): void {
    this.errorState.set(null);
  }

  async createCollection(name: string): Promise<Collection | null> {
    const now = Date.now();
    const collection: Collection = {
      id: newId(),
      schemaVersion: SCHEMA_VERSION,
      createdAt: now,
      updatedAt: now,
      name: cleanName(name, 'New collection'),
      description: '',
      sortOrder: nextSortOrder(this.collections()),
    };
    return this.persist(async () => {
      await this.db.collections.add(collection);
      this.collectionsState.update((list) => [...list, collection]);
      return collection;
    });
  }

  async renameCollection(id: string, name: string): Promise<void> {
    const changes = { name: cleanName(name, 'Untitled collection'), updatedAt: Date.now() };
    await this.persist(async () => {
      await this.db.collections.update(id, changes);
      this.collectionsState.update((list) => list.map((c) => (c.id === id ? { ...c, ...changes } : c)));
    });
  }

  /** True when the collection exists and, if given, the folder belongs to it. */
  isValidLocation(collectionId: string, folderId: string | null): boolean {
    if (!this.collections().some((c) => c.id === collectionId)) return false;
    return folderId === null || this.folders().some((f) => f.id === folderId && f.collectionId === collectionId);
  }

  /** Deletes a collection together with its folders and saved requests. */
  async deleteCollection(id: string): Promise<void> {
    const folderIds = this.folders().filter((f) => f.collectionId === id).map((f) => f.id);
    const done = await this.persist(async () => {
      await this.db.transaction('rw', this.db.collections, this.db.folders, this.db.requests, async () => {
        await this.db.requests.where('collectionId').equals(id).delete();
        await this.db.folders.where('collectionId').equals(id).delete();
        await this.db.collections.delete(id);
      });
      this.foldersState.update((list) => list.filter((f) => f.collectionId !== id));
      this.collectionsState.update((list) => list.filter((c) => c.id !== id));
      return true;
    });
    if (done) this.removals$.next({ collectionId: id, folderIds });
  }

  /** Creates a folder directly in a collection, or inside another folder of it. */
  async createFolder(collectionId: string, parentId: string | null, name: string): Promise<Folder | null> {
    const parent = parentId === null ? null : this.folders().find((f) => f.id === parentId);
    const collectionExists = this.collections().some((c) => c.id === collectionId);
    if (!collectionExists || parent === undefined || (parent !== null && parent.collectionId !== collectionId)) {
      this.errorState.set('That location no longer exists, so the folder was not created.');
      return null;
    }
    const now = Date.now();
    const siblings = this.folders().filter((f) => f.collectionId === collectionId && f.parentId === parentId);
    const folder: Folder = {
      id: newId(),
      schemaVersion: SCHEMA_VERSION,
      createdAt: now,
      updatedAt: now,
      name: cleanName(name, 'New folder'),
      collectionId,
      parentId,
      sortOrder: nextSortOrder(siblings),
    };
    return this.persist(async () => {
      await this.db.folders.add(folder);
      this.foldersState.update((list) => [...list, folder]);
      return folder;
    });
  }

  async renameFolder(id: string, name: string): Promise<void> {
    const changes = { name: cleanName(name, 'Untitled folder'), updatedAt: Date.now() };
    await this.persist(async () => {
      await this.db.folders.update(id, changes);
      this.foldersState.update((list) => list.map((f) => (f.id === id ? { ...f, ...changes } : f)));
    });
  }

  /** Deletes a folder with every folder inside it and all their saved requests. */
  async deleteFolder(id: string): Promise<void> {
    const ids = folderSubtreeIds(this.folders(), id);
    const done = await this.persist(async () => {
      await this.db.transaction('rw', this.db.folders, this.db.requests, async () => {
        await this.db.requests.where('folderId').anyOf([...ids]).delete();
        await this.db.folders.bulkDelete([...ids]);
      });
      this.foldersState.update((list) => list.filter((f) => !ids.includes(f.id)));
      return true;
    });
    if (done) this.removals$.next({ collectionId: null, folderIds: ids });
  }

  private async load(): Promise<void> {
    try {
      const [collections, folders] = await Promise.all([this.db.collections.orderBy('sortOrder').toArray(), this.db.folders.toArray()]);
      this.collectionsState.set(collections);
      this.foldersState.set(folders);
    } catch (error) {
      this.errorState.set(describeStorageError(error, 'load'));
    } finally {
      this.loadedState.set(true);
    }
  }

  /** Runs a storage operation, turning failures into a visible message instead of an unhandled rejection. */
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
