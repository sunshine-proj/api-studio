import { Injectable, InjectionToken, OnDestroy, inject } from '@angular/core';
import Dexie, { EntityTable } from 'dexie';
import { Collection, Folder, SavedRequest } from '../models';

export const DATABASE_NAME = new InjectionToken<string>('DATABASE_NAME', {
  providedIn: 'root',
  factory: () => 'api-studio',
});

/**
 * Typed IndexedDB schema. Every change to a stored shape needs a new
 * `version()` block here (with an `upgrade` function when data must move).
 * Tables are added by the feature that first needs them.
 */
export class ApiStudioDatabase extends Dexie {
  readonly collections!: EntityTable<Collection, 'id'>;
  readonly folders!: EntityTable<Folder, 'id'>;
  readonly requests!: EntityTable<SavedRequest, 'id'>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      collections: 'id, sortOrder',
      folders: 'id, collectionId, parentId',
    });
    // Version 2 adds saved requests. No existing data has to change.
    this.version(2).stores({
      requests: 'id, collectionId, folderId',
    });
  }
}

/** The application's single database connection. */
@Injectable({ providedIn: 'root' })
export class DatabaseService extends ApiStudioDatabase implements OnDestroy {
  constructor() {
    super(inject(DATABASE_NAME));
  }

  ngOnDestroy(): void {
    this.close();
  }
}
