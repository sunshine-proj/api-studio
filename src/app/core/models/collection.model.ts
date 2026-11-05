import { PersistedEntity } from './common.model';

export interface Collection extends PersistedEntity {
  readonly name: string;
  readonly description: string;
  readonly sortOrder: number;
}

export interface Folder extends PersistedEntity {
  readonly name: string;
  readonly collectionId: string;
  /** Parent folder id, or null when directly under the collection. */
  readonly parentId: string | null;
  readonly sortOrder: number;
}
