import { Injectable, inject } from '@angular/core';
import { DatabaseService } from '../database/database.service';
import { Collection, Environment } from '../models';
import { ImportBundle, ImportFormat } from '../import-export/import-bundle.model';
import { ExportSource, buildNativeExport, readNativeExport, withoutSecrets } from '../import-export/native-format.util';
import { isOpenApiDocument, readOpenApi } from '../import-export/openapi-import.util';
import { buildPostmanExport, isPostmanCollection, readPostmanCollection } from '../import-export/postman-format.util';
import { ImportError, MAX_IMPORT_BYTES, parseUntrustedJson } from '../import-export/safe-json.util';
import { sanitizeFilename } from '../utils/download';
import { SecretVariable } from '../utils/redaction.util';
import { describeStorageError } from '../utils/storage-error.util';
import { CollectionStore } from './collection-store.service';
import { EnvironmentStore } from './environment-store.service';
import { SavedRequestStore } from './saved-request-store.service';

export interface ImportPreview {
  readonly format: ImportFormat;
  readonly bundle: ImportBundle;
}

export type CommitResult = { readonly ok: true } | { readonly ok: false; readonly message: string };

export interface ExportSelection {
  /** Collections to export. */
  readonly collectionIds: readonly string[];
  readonly includeEnvironments: boolean;
}

/** What an export would contain that should not be shared casually. */
export interface Sensitivity {
  /** Secret variables with a value, in the environments that would be exported. */
  readonly secretVariables: number;
  /** Requests holding literal credentials (tokens, passwords, Authorization headers) or secret values. */
  readonly requestsWithCredentials: number;
}

export interface ExportFile {
  readonly filename: string;
  readonly content: string;
  readonly mimeType: string;
}

/**
 * Import and export of collections, requests and environments. Imports are
 * converted into a bundle that the user can review; nothing is stored until
 * `commit` is called. Imported files are treated as untrusted throughout.
 */
@Injectable({ providedIn: 'root' })
export class ImportExportService {
  private readonly db = inject(DatabaseService);
  private readonly collections = inject(CollectionStore);
  private readonly requests = inject(SavedRequestStore);
  private readonly environments = inject(EnvironmentStore);

  // --- Import ---

  /** Reads a chosen file. Oversized files are refused before their content is read. */
  async readFile(file: File): Promise<ImportPreview> {
    if (file.size > MAX_IMPORT_BYTES) {
      throw new ImportError(`The file is larger than the ${Math.round(MAX_IMPORT_BYTES / (1024 * 1024))} MB import limit.`);
    }
    return this.prepare(await file.text());
  }

  /** Detects the format of JSON text and converts it. Throws `ImportError` with a user-facing message. */
  prepare(text: string): ImportPreview {
    const document = parseUntrustedJson(text);
    if (typeof document === 'object' && document !== null && (document as Record<string, unknown>)['format'] === 'api-studio') {
      return { format: 'api-studio', bundle: readNativeExport(document) };
    }
    if (isPostmanCollection(document)) return { format: 'postman', bundle: readPostmanCollection(document) };
    if (isOpenApiDocument(document)) return { format: 'openapi', bundle: readOpenApi(document) };
    throw new ImportError('The file is not a recognized format. API Studio exports, Postman collections (v2) and OpenAPI/Swagger JSON are supported.');
  }

  /**
   * Adds the bundle to the database in one transaction (all or nothing), after
   * the existing data, then refreshes the stores. Existing data is never changed.
   */
  async commit(bundle: ImportBundle): Promise<CommitResult> {
    const now = Date.now();
    const firstOrder = this.collections.collections().reduce((max, c) => Math.max(max, c.sortOrder), -1) + 1;
    const newestEnvironment = this.environments.environments().reduce((max, e) => Math.max(max, e.createdAt), 0);
    const collections: Collection[] = [...bundle.collections]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((collection, index) => ({ ...collection, sortOrder: firstOrder + index }));
    // Distinct creation times keep the imported environments in file order.
    const environments: Environment[] = bundle.environments.map((env, index) => ({
      ...env,
      createdAt: Math.max(now, newestEnvironment + 1) + index,
    }));
    try {
      await this.db.transaction('rw', this.db.collections, this.db.folders, this.db.requests, this.db.environments, async () => {
        await this.db.collections.bulkAdd(collections);
        await this.db.folders.bulkAdd([...bundle.folders]);
        await this.db.requests.bulkAdd([...bundle.requests]);
        await this.db.environments.bulkAdd(environments);
      });
    } catch (error) {
      return { ok: false, message: describeStorageError(error, 'save') };
    }
    await Promise.all([this.collections.reload(), this.requests.reload(), this.environments.reload()]);
    return { ok: true };
  }

  // --- Export ---

  /** The data selected for export, plus the secret values of every environment for scrubbing. */
  source(selection: ExportSelection): ExportSource {
    const chosen = new Set(selection.collectionIds);
    const secrets: SecretVariable[] = this.environments
      .environments()
      .flatMap((env) => env.variables)
      .filter((variable) => variable.secret && variable.value !== '' && variable.name !== '')
      .map((variable) => ({ name: variable.name, value: variable.value }));
    return {
      collections: this.collections.collections().filter((c) => chosen.has(c.id)),
      folders: this.collections.folders().filter((f) => chosen.has(f.collectionId)),
      requests: this.requests.requests().filter((r) => chosen.has(r.collectionId)),
      environments: selection.includeEnvironments ? this.environments.environments() : [],
      secrets,
    };
  }

  /** Counts what a plain-text export would expose, so the user can be warned first. */
  sensitivity(selection: ExportSelection): Sensitivity {
    const source = this.source(selection);
    const clean = withoutSecrets(source);
    const secretVariables = source.environments.flatMap((env) => env.variables).filter((v) => v.secret && v.value !== '').length;
    const requestsWithCredentials = source.requests.filter(
      (request, index) => JSON.stringify(request.definition) !== JSON.stringify(clean.requests[index].definition),
    ).length;
    return { secretVariables, requestsWithCredentials };
  }

  exportNative(selection: ExportSelection, includeSecrets: boolean, now = new Date()): ExportFile {
    return {
      filename: `api-studio-export-${now.toISOString().slice(0, 10)}.json`,
      content: buildNativeExport(this.source(selection), { includeSecrets }, now),
      mimeType: 'application/json',
    };
  }

  /** One collection in Postman Collection v2.1 format. Environments are not part of that format. */
  exportPostman(collectionId: string, includeSecrets: boolean): ExportFile {
    const source = this.source({ collectionIds: [collectionId], includeEnvironments: false });
    const name = source.collections[0]?.name ?? 'collection';
    return {
      filename: `${sanitizeFilename(name)}.postman_collection.json`,
      content: buildPostmanExport(source, collectionId, { includeSecrets }),
      mimeType: 'application/json',
    };
  }
}
