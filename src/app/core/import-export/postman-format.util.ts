import {
  AuthConfig,
  Collection,
  Environment,
  FileReference,
  FormDataField,
  Folder,
  KeyValue,
  RequestBody,
  RequestDefinition,
  SCHEMA_VERSION,
  SavedRequest,
  TextBodyLanguage,
} from '../models';
import { cleanName } from '../utils/collection-tree.util';
import { newId } from '../utils/id';
import { createEmptyRequest } from '../utils/request-factory';
import { paramsFromUrl } from '../utils/url.util';
import { warnAboutUrl } from './definition-reader.util';
import { ImportBundle } from './import-bundle.model';
import { ExportSource, NativeExportOptions, withoutSecrets } from './native-format.util';
import { ImportNotes, JsonRecord, isRecord, readBoolean, readList, readRecords, readString } from './reading.util';
import { ImportError } from './safe-json.util';

export const POSTMAN_SCHEMA = 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json';

/** True when a parsed document looks like a Postman collection (v2.x). */
export function isPostmanCollection(document: unknown): document is JsonRecord {
  return isRecord(document) && isRecord(document['info']) && Array.isArray(document['item']);
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

interface Context {
  readonly notes: ImportNotes;
  readonly stamp: { readonly schemaVersion: number; readonly createdAt: number; readonly updatedAt: number };
  readonly collection: Collection;
  readonly folders: Folder[];
  readonly requests: SavedRequest[];
  scripts: number;
}

/** Looks up one value in a Postman auth parameter list: `[{ key: 'token', value: '…' }]`. */
function authParam(list: unknown, key: string): string {
  const entry = readRecords(list).find((row) => row['key'] === key);
  const value = entry?.['value'];
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
}

/**
 * Converts Postman auth. Returns undefined when the item sets none (so it
 * inherits from its parent), and `{ type: 'none' }` for an explicit "No Auth".
 */
function readAuth(auth: unknown, notes: ImportNotes): AuthConfig | undefined {
  if (!isRecord(auth)) return undefined;
  const type = readString(auth['type']);
  switch (type) {
    case 'noauth':
      return { type: 'none' };
    case 'bearer':
      return { type: 'bearer', token: authParam(auth['bearer'], 'token') };
    case 'basic':
      return { type: 'basic', username: authParam(auth['basic'], 'username'), password: authParam(auth['basic'], 'password') };
    case 'apikey':
      return {
        type: 'apiKey',
        key: authParam(auth['apikey'], 'key'),
        value: authParam(auth['apikey'], 'value'),
        placement: authParam(auth['apikey'], 'in') === 'query' ? 'query' : 'header',
      };
    default:
      notes.add(`Authorization of type "${type || 'unknown'}" is not supported and was imported as "No authorization".`);
      return { type: 'none' };
  }
}

function fileRef(src: unknown): FileReference | undefined {
  const text = Array.isArray(src) ? src.find((s): s is string => typeof s === 'string') : src;
  if (typeof text !== 'string' || text === '') return undefined;
  const name = text.split(/[\\/]/).pop() ?? text;
  return { name: name.slice(0, 255), size: 0, mimeType: '' };
}

function guessLanguage(declared: string, headers: readonly KeyValue[]): TextBodyLanguage {
  const known: Record<string, TextBodyLanguage> = { json: 'json', xml: 'xml', javascript: 'javascript', text: 'text' };
  if (known[declared] !== undefined) return known[declared];
  const contentType = headers.find((h) => h.key.toLowerCase() === 'content-type')?.value.toLowerCase() ?? '';
  if (contentType.includes('json')) return 'json';
  if (contentType.includes('xml')) return 'xml';
  return 'text';
}

function readBody(body: unknown, headers: readonly KeyValue[], notes: ImportNotes): RequestBody {
  if (!isRecord(body)) return { type: 'none' };
  switch (readString(body['mode'])) {
    case 'raw': {
      const raw = isRecord(body['options']) && isRecord(body['options']['raw']) ? body['options']['raw'] : {};
      return { type: 'text', language: guessLanguage(readString(raw['language']), headers), content: readString(body['raw']) };
    }
    case 'urlencoded':
      return {
        type: 'urlencoded',
        fields: readRecords(body['urlencoded']).map((row) => ({
          id: newId(),
          key: readString(row['key']),
          value: readString(row['value']),
          enabled: !readBoolean(row['disabled'], false),
        })),
      };
    case 'formdata': {
      let reselect = false;
      const fields = readRecords(body['formdata']).map((row): FormDataField => {
        const file = row['type'] === 'file' ? fileRef(row['src']) : undefined;
        if (row['type'] === 'file') reselect = true;
        return {
          id: newId(),
          key: readString(row['key']),
          enabled: !readBoolean(row['disabled'], false),
          kind: file ? 'file' : 'text',
          value: readString(row['value']),
          ...(file ? { file } : {}),
        };
      });
      if (reselect) notes.add('File fields keep only the file name. Choose the files again before sending.');
      return { type: 'multipart', fields };
    }
    case 'file': {
      notes.add('File fields keep only the file name. Choose the files again before sending.');
      return { type: 'binary', file: isRecord(body['file']) ? fileRef(body['file']['src']) : undefined };
    }
    case '':
      return { type: 'none' };
    default:
      notes.add(`Request bodies of type "${readString(body['mode'])}" (such as GraphQL) are not supported and were imported without a body.`);
      return { type: 'none' };
  }
}

function readUrl(url: unknown): { readonly raw: string; readonly disabledQuery: readonly KeyValue[] } {
  if (typeof url === 'string') return { raw: url, disabledQuery: [] };
  if (!isRecord(url)) return { raw: '', disabledQuery: [] };
  let raw = readString(url['raw']);
  if (raw === '') {
    const host = Array.isArray(url['host']) ? readList(url['host']).join('.') : readString(url['host']);
    const path = Array.isArray(url['path']) ? readList(url['path']).join('/') : readString(url['path']);
    const protocol = readString(url['protocol']);
    raw = host === '' ? '' : `${protocol ? `${protocol}://` : ''}${host}${path ? `/${path}` : ''}`;
  }
  const disabledQuery = readRecords(url['query'])
    .filter((row) => readBoolean(row['disabled'], false))
    .map((row) => ({ id: newId(), key: readString(row['key']), value: readString(row['value']), enabled: false }));
  return { raw, disabledQuery };
}

function readRequest(request: unknown, inherited: AuthConfig | undefined, ctx: Context): RequestDefinition {
  const source: JsonRecord = typeof request === 'string' ? { url: request } : isRecord(request) ? request : {};
  const headers: readonly KeyValue[] = readRecords(source['header']).map((row) => ({
    id: newId(),
    key: readString(row['key']),
    value: readString(row['value']),
    enabled: !readBoolean(row['disabled'], false),
  }));
  const { raw, disabledQuery } = readUrl(source['url']);
  warnAboutUrl(raw, ctx.notes);
  return {
    ...createEmptyRequest(),
    method: readString(source['method'], 'GET').toUpperCase() || 'GET',
    url: raw,
    params: [...paramsFromUrl(raw, []), ...disabledQuery],
    headers,
    auth: readAuth(source['auth'], ctx.notes) ?? inherited ?? { type: 'none' },
    body: readBody(source['body'], headers, ctx.notes),
  };
}

function readItems(items: unknown, parentFolder: string | null, inherited: AuthConfig | undefined, ctx: Context): void {
  const entries = readRecords(items);
  entries.forEach((item, index) => {
    if (readList(item['event']).length > 0) ctx.scripts++;
    const name = readString(item['name']);
    const own = readAuth(item['auth'], ctx.notes);
    if (Array.isArray(item['item'])) {
      const folder: Folder = {
        id: newId(),
        ...ctx.stamp,
        name: cleanName(name, 'Imported folder'),
        collectionId: ctx.collection.id,
        parentId: parentFolder,
        sortOrder: index,
      };
      ctx.folders.push(folder);
      readItems(item['item'], folder.id, own ?? inherited, ctx);
    } else if (item['request'] !== undefined) {
      ctx.requests.push({
        id: newId(),
        ...ctx.stamp,
        name: cleanName(name, 'Imported request'),
        collectionId: ctx.collection.id,
        folderId: parentFolder,
        sortOrder: index,
        definition: readRequest(item['request'], own ?? inherited, ctx),
      });
    }
  });
}

/** Converts a parsed Postman collection (v2.0 / v2.1) into a bundle. Scripts are never imported or run. */
export function readPostmanCollection(document: unknown, now = Date.now()): ImportBundle {
  if (!isPostmanCollection(document)) throw new ImportError('This is not a Postman collection.');
  const info = document['info'] as JsonRecord;
  const stamp = { schemaVersion: SCHEMA_VERSION, createdAt: now, updatedAt: now };
  const collection: Collection = {
    id: newId(),
    ...stamp,
    name: cleanName(readString(info['name']), 'Imported collection'),
    description: readString(info['description']),
    sortOrder: 0,
  };
  const ctx: Context = { notes: new ImportNotes(), stamp, collection, folders: [], requests: [], scripts: 0 };
  if (readList(document['event']).length > 0) ctx.scripts++;
  readItems(document['item'], null, readAuth(document['auth'], ctx.notes), ctx);

  if (ctx.scripts > 0) {
    ctx.notes.add(
      `${ctx.scripts} pre-request/test script${ctx.scripts === 1 ? ' was' : 's were'} not imported. Scripts are never run.`,
    );
  }

  const variables = readRecords(document['variable']).filter((v) => readString(v['key']) !== '');
  const environments: Environment[] = [];
  if (variables.length > 0) {
    environments.push({
      id: newId(),
      ...stamp,
      name: cleanName(`${collection.name} variables`, 'Imported variables'),
      variables: variables.map((v) => ({
        id: newId(),
        name: readString(v['key']),
        value: typeof v['value'] === 'string' ? v['value'] : typeof v['value'] === 'number' ? String(v['value']) : '',
        enabled: !readBoolean(v['disabled'], false),
        secret: false,
      })),
    });
    ctx.notes.add('Collection variables were imported as a separate environment. Select it to use them.');
  }
  return { collections: [collection], folders: ctx.folders, requests: ctx.requests, environments, warnings: ctx.notes.toArray() };
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

const bySort = <T extends { readonly sortOrder: number; readonly name: string }>(a: T, b: T): number =>
  a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);

function exportAuth(auth: AuthConfig): JsonRecord | undefined {
  const param = (key: string, value: string) => ({ key, value, type: 'string' });
  switch (auth.type) {
    case 'bearer':
      return { type: 'bearer', bearer: [param('token', auth.token)] };
    case 'basic':
      return { type: 'basic', basic: [param('username', auth.username), param('password', auth.password)] };
    case 'apiKey':
      return { type: 'apikey', apikey: [param('key', auth.key), param('value', auth.value), param('in', auth.placement)] };
    default:
      return undefined; // "none" and custom headers (exported as a header below)
  }
}

function exportBody(body: RequestBody): JsonRecord | undefined {
  switch (body.type) {
    case 'none':
      return undefined;
    case 'text':
      return { mode: 'raw', raw: body.content, options: { raw: { language: body.language === 'text' ? 'text' : body.language } } };
    case 'urlencoded':
      return { mode: 'urlencoded', urlencoded: body.fields.map((f) => ({ key: f.key, value: f.value, ...(f.enabled ? {} : { disabled: true }) })) };
    case 'multipart':
      return {
        mode: 'formdata',
        formdata: body.fields.map((f) => ({
          key: f.key,
          ...(f.kind === 'file' ? { type: 'file', src: f.file?.name ?? '' } : { type: 'text', value: f.value }),
          ...(f.enabled ? {} : { disabled: true }),
        })),
      };
    case 'binary':
      return { mode: 'file', file: { src: body.file?.name ?? '' } };
  }
}

function exportRequest(request: SavedRequest): JsonRecord {
  const { definition } = request;
  const headers = definition.headers.map((h) => ({ key: h.key, value: h.value, ...(h.enabled ? {} : { disabled: true }) }));
  if (definition.auth.type === 'custom' && definition.auth.headerName !== '') {
    headers.push({ key: definition.auth.headerName, value: definition.auth.headerValue });
  }
  const auth = exportAuth(definition.auth);
  const body = exportBody(definition.body);
  return {
    name: request.name,
    request: {
      method: definition.method,
      header: headers,
      url: {
        raw: definition.url,
        query: definition.params.map((p) => ({ key: p.key, value: p.value, ...(p.enabled ? {} : { disabled: true }) })),
      },
      ...(auth ? { auth } : {}),
      ...(body ? { body } : {}),
    },
    response: [],
  };
}

/** Builds a Postman Collection v2.1 document for one collection. */
export function buildPostmanExport(source: ExportSource, collectionId: string, options: NativeExportOptions): string {
  const data = options.includeSecrets ? source : withoutSecrets(source);
  const collection = data.collections.find((c) => c.id === collectionId);
  if (!collection) throw new ImportError('The collection to export no longer exists.');

  const inFolder = (folderId: string | null): JsonRecord[] => [
    ...data.folders
      .filter((f) => f.collectionId === collectionId && f.parentId === folderId)
      .sort(bySort)
      .map((f): JsonRecord => ({ name: f.name, item: inFolder(f.id) })),
    ...data.requests
      .filter((r) => r.collectionId === collectionId && r.folderId === folderId)
      .sort(bySort)
      .map(exportRequest),
  ];

  return JSON.stringify(
    {
      info: { name: collection.name, description: collection.description, schema: POSTMAN_SCHEMA },
      item: inFolder(null),
    },
    null,
    2,
  );
}
