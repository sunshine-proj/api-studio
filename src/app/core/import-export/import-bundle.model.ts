import { Collection, Environment, Folder, SavedRequest } from '../models';

/**
 * Everything an import wants to add, with fresh ids and consistent references.
 * Importers produce a bundle; nothing is written until the user confirms it.
 */
export interface ImportBundle {
  readonly collections: readonly Collection[];
  readonly folders: readonly Folder[];
  readonly requests: readonly SavedRequest[];
  readonly environments: readonly Environment[];
  /** Parts of the file that were skipped or changed, shown before importing. */
  readonly warnings: readonly string[];
}

export type ImportFormat = 'api-studio' | 'postman' | 'openapi';

export const IMPORT_FORMAT_LABELS: Readonly<Record<ImportFormat, string>> = {
  'api-studio': 'API Studio export',
  postman: 'Postman collection',
  openapi: 'OpenAPI description',
};
