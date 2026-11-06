import {
  Collection,
  Environment,
  EnvironmentVariable,
  Folder,
  SCHEMA_VERSION,
  SavedRequest,
} from '../models';
import { cleanName } from '../utils/collection-tree.util';
import { newId } from '../utils/id';
import { SecretVariable, redactDefinition } from '../utils/redaction.util';
import { readDefinition, warnAboutUrl } from './definition-reader.util';
import { ImportBundle } from './import-bundle.model';
import { ImportNotes, isRecord, readBoolean, readNumber, readRecords, readString } from './reading.util';
import { ImportError } from './safe-json.util';

export const NATIVE_FORMAT = 'api-studio';
export const NATIVE_VERSION = 1;

/** The data an export is built from. */
export interface ExportSource {
  readonly collections: readonly Collection[];
  readonly folders: readonly Folder[];
  readonly requests: readonly SavedRequest[];
  readonly environments: readonly Environment[];
  /**
   * Secret variable values from every environment, including ones that are not
   * exported, so their values can still be scrubbed out of the requests.
   */
  readonly secrets?: readonly SecretVariable[];
}

export interface NativeExportOptions {
  /** Keep literal credentials and the values of secret variables. Off by default. */
  readonly includeSecrets: boolean;
}

/**
 * Removes secrets from a source the way history does: literal credentials in
 * requests are emptied, secret variable values are replaced by `{{name}}`
 * where they appear in requests, and secret environment values are blanked.
 */
export function withoutSecrets(source: ExportSource): ExportSource {
  const secrets: SecretVariable[] = [
    ...(source.secrets ?? []),
    ...source.environments
      .flatMap((env) => env.variables)
      .filter((variable) => variable.secret && variable.value !== '' && variable.name !== '')
      .map((variable) => ({ name: variable.name, value: variable.value })),
  ];
  return {
    ...source,
    requests: source.requests.map((request) => ({ ...request, definition: redactDefinition(request.definition, secrets) })),
    environments: source.environments.map((env) => ({
      ...env,
      variables: env.variables.map((variable) => (variable.secret ? { ...variable, value: '' } : variable)),
    })),
  };
}

/** Serializable export document. Ids only tie the entries together; they are replaced on import. */
export function buildNativeExport(source: ExportSource, options: NativeExportOptions, now = new Date()): string {
  const data = options.includeSecrets ? source : withoutSecrets(source);
  const document = {
    format: NATIVE_FORMAT,
    version: NATIVE_VERSION,
    exportedAt: now.toISOString(),
    includesSecrets: options.includeSecrets,
    collections: data.collections.map((c) => ({ id: c.id, name: c.name, description: c.description, sortOrder: c.sortOrder })),
    folders: data.folders.map((f) => ({ id: f.id, name: f.name, collectionId: f.collectionId, parentId: f.parentId, sortOrder: f.sortOrder })),
    requests: data.requests.map((r) => ({
      id: r.id,
      name: r.name,
      collectionId: r.collectionId,
      folderId: r.folderId,
      sortOrder: r.sortOrder,
      definition: r.definition,
    })),
    environments: data.environments.map((e) => ({
      id: e.id,
      name: e.name,
      variables: e.variables.map((v) => ({ name: v.name, value: v.value, enabled: v.enabled, secret: v.secret })),
    })),
  };
  return JSON.stringify(document, null, 2);
}

function readId(value: unknown): string | null {
  return typeof value === 'string' && value !== '' && value.length <= 200 ? value : null;
}

function readVariables(value: unknown): readonly EnvironmentVariable[] {
  return readRecords(value).map((row) => ({
    id: newId(),
    name: readString(row['name']),
    value: readString(row['value']),
    enabled: readBoolean(row['enabled'], true),
    secret: readBoolean(row['secret'], false),
  }));
}

/**
 * Validates a parsed native export and turns it into a bundle with fresh ids.
 * A wrong overall shape or version refuses the whole file. Individual entries
 * that are invalid, duplicated, or refer to something missing are skipped and
 * reported, never guessed at.
 */
export function readNativeExport(document: unknown, now = Date.now()): ImportBundle {
  if (!isRecord(document) || document['format'] !== NATIVE_FORMAT) {
    throw new ImportError('This is not an API Studio export.');
  }
  const version = document['version'];
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new ImportError('The export has no valid version number.');
  }
  if (version > NATIVE_VERSION) {
    throw new ImportError(`The export was made by a newer version of API Studio (format version ${version}). Update the app to import it.`);
  }
  for (const key of ['collections', 'folders', 'requests', 'environments'] as const) {
    if (document[key] !== undefined && !Array.isArray(document[key])) {
      throw new ImportError(`The export is malformed: "${key}" must be a list.`);
    }
  }

  const notes = new ImportNotes();
  const stamp = { schemaVersion: SCHEMA_VERSION, createdAt: now, updatedAt: now };

  // Collections.
  const collectionIds = new Map<string, string>();
  const collections: Collection[] = [];
  for (const raw of readRecords(document['collections'])) {
    const oldId = readId(raw['id']);
    if (oldId === null || collectionIds.has(oldId)) {
      notes.add('A collection with a missing or duplicate id was skipped.');
      continue;
    }
    const id = newId();
    collectionIds.set(oldId, id);
    collections.push({
      id,
      ...stamp,
      name: cleanName(readString(raw['name']), 'Imported collection'),
      description: readString(raw['description']),
      sortOrder: readNumber(raw['sortOrder'], collections.length, -1e9, 1e9),
    });
  }

  // Folders: keep only those that reach a collection through existing parents (this also drops cycles).
  const pending = readRecords(document['folders']).flatMap((raw) => {
    const oldId = readId(raw['id']);
    const collectionId = readId(raw['collectionId']);
    if (oldId === null || collectionId === null || !collectionIds.has(collectionId)) {
      notes.add('A folder with a missing id or collection was skipped.');
      return [];
    }
    return [{ raw, oldId, collectionId, parentOld: readId(raw['parentId']) }];
  });
  const folderIds = new Map<string, string>();
  const folders: Folder[] = [];
  for (let progress = true; progress && pending.length > 0; ) {
    progress = false;
    for (let i = pending.length - 1; i >= 0; i--) {
      const item = pending[i];
      const parent = item.parentOld === null ? null : folderIds.get(item.parentOld);
      if (parent === undefined || folderIds.has(item.oldId)) continue;
      const parentFolder = parent === null ? null : folders.find((f) => f.id === parent);
      if (parentFolder && parentFolder.collectionId !== collectionIds.get(item.collectionId)) continue;
      const id = newId();
      folderIds.set(item.oldId, id);
      folders.push({
        id,
        ...stamp,
        name: cleanName(readString(item.raw['name']), 'Imported folder'),
        collectionId: collectionIds.get(item.collectionId)!,
        parentId: parent,
        sortOrder: readNumber(item.raw['sortOrder'], 0, -1e9, 1e9),
      });
      pending.splice(i, 1);
      progress = true;
    }
  }
  if (pending.length > 0) {
    notes.add(`${pending.length} folder${pending.length === 1 ? '' : 's'} with a missing or circular parent (and what they contain) were skipped.`);
  }

  // Requests.
  const requests: SavedRequest[] = [];
  for (const raw of readRecords(document['requests'])) {
    const collectionId = readId(raw['collectionId']);
    const folderOld = readId(raw['folderId']);
    const definition = readDefinition(raw['definition'], notes);
    const newCollection = collectionId === null ? undefined : collectionIds.get(collectionId);
    const newFolder = folderOld === null ? null : folderIds.get(folderOld);
    const folder = newFolder === null || newFolder === undefined ? null : (folders.find((f) => f.id === newFolder) ?? null);
    if (
      definition === null ||
      newCollection === undefined ||
      newFolder === undefined ||
      (folder !== null && folder.collectionId !== newCollection)
    ) {
      notes.add('A request that is invalid or whose collection or folder is missing was skipped.');
      continue;
    }
    warnAboutUrl(definition.url, notes);
    requests.push({
      id: newId(),
      ...stamp,
      name: cleanName(readString(raw['name']), 'Imported request'),
      collectionId: newCollection,
      folderId: newFolder,
      sortOrder: readNumber(raw['sortOrder'], 0, -1e9, 1e9),
      definition,
    });
  }

  // Environments.
  const environments: Environment[] = readRecords(document['environments']).map((raw) => ({
    id: newId(),
    ...stamp,
    name: cleanName(readString(raw['name']), 'Imported environment'),
    variables: readVariables(raw['variables']),
  }));

  if (document['includesSecrets'] === false) {
    notes.add('This export was made without credentials and secret values. Enter them again before sending.');
  }
  return { collections, folders, requests, environments, warnings: notes.toArray() };
}
