import {
  AuthConfig,
  Collection,
  Environment,
  EnvironmentVariable,
  FormDataField,
  Folder,
  KeyValue,
  RequestBody,
  RequestDefinition,
  SCHEMA_VERSION,
  SavedRequest,
} from '../models';
import { cleanName } from '../utils/collection-tree.util';
import { newId } from '../utils/id';
import { createEmptyRequest } from '../utils/request-factory';
import { buildUrl } from '../utils/url.util';
import { ImportBundle } from './import-bundle.model';
import { ImportNotes, JsonRecord, isRecord, readList, readRecords, readString } from './reading.util';
import { ImportError } from './safe-json.util';

/** True when a parsed document looks like an OpenAPI 3.x or Swagger 2.0 description. */
export function isOpenApiDocument(document: unknown): document is JsonRecord {
  return isRecord(document) && (typeof document['openapi'] === 'string' || document['swagger'] === '2.0');
}

const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch'] as const;
/** Parameters that the executor or browser sets itself. */
const SKIPPED_HEADER_PARAMS: ReadonlySet<string> = new Set(['accept', 'content-type', 'authorization']);
const MAX_SCHEMA_DEPTH = 6;
const MAX_EXAMPLE_NODES = 2000;
const JSON_POINTER_HOPS = 10;

// ---------------------------------------------------------------------------
// $ref and schema helpers. Only local references ("#/…") are followed: nothing is ever fetched.
// ---------------------------------------------------------------------------

class Resolver {
  constructor(
    private readonly root: JsonRecord,
    private readonly notes: ImportNotes,
  ) {}

  /** Follows a chain of local `$ref`s. Returns an empty object for unresolvable or external ones. */
  resolve(node: unknown): JsonRecord {
    let current: unknown = node;
    for (let hop = 0; hop < JSON_POINTER_HOPS; hop++) {
      if (!isRecord(current)) return {};
      const ref = current['$ref'];
      if (typeof ref !== 'string') return current;
      current = this.lookup(ref);
    }
    this.notes.add('A chain of $ref references was too long (or circular) and was ignored.');
    return {};
  }

  private lookup(ref: string): unknown {
    if (!ref.startsWith('#/')) {
      this.notes.add('References to other files or URLs ($ref) are not followed. The parts that use them were left empty.');
      return undefined;
    }
    let node: unknown = this.root;
    for (const part of ref.slice(2).split('/')) {
      const key = decodeURIComponent(part).replace(/~1/g, '/').replace(/~0/g, '~');
      node = isRecord(node) && Object.prototype.hasOwnProperty.call(node, key) ? node[key] : undefined;
    }
    return node;
  }
}

/** Builds an example value from a schema, bounded in depth and size so recursive schemas cannot run away. */
function exampleFromSchema(schema: unknown, resolver: Resolver, budget: { left: number }, depth = 0): unknown {
  if (budget.left-- <= 0 || depth > MAX_SCHEMA_DEPTH) return null;
  const node = resolver.resolve(schema);
  if (node['example'] !== undefined) return node['example'];
  if (node['default'] !== undefined) return node['default'];
  const choices = readList(node['enum']);
  if (choices.length > 0) return choices[0];

  const merged = readList(node['allOf']);
  if (merged.length > 0) {
    const parts = merged.map((part) => exampleFromSchema(part, resolver, budget, depth + 1));
    return parts.every(isRecord) ? Object.assign({}, ...parts) : parts[0];
  }
  const alternative = readList(node['oneOf'])[0] ?? readList(node['anyOf'])[0];
  if (alternative !== undefined) return exampleFromSchema(alternative, resolver, budget, depth + 1);

  const type = readString(node['type']) || (isRecord(node['properties']) ? 'object' : '');
  switch (type) {
    case 'object': {
      const properties = isRecord(node['properties']) ? node['properties'] : {};
      return Object.fromEntries(
        Object.entries(properties).map(([name, property]) => [name, exampleFromSchema(property, resolver, budget, depth + 1)]),
      );
    }
    case 'array':
      return [exampleFromSchema(node['items'], resolver, budget, depth + 1)];
    case 'integer':
    case 'number':
      return 0;
    case 'boolean':
      return false;
    case 'string':
      switch (readString(node['format'])) {
        case 'date-time':
          return '2024-01-01T00:00:00Z';
        case 'date':
          return '2024-01-01';
        case 'uuid':
          return '00000000-0000-0000-0000-000000000000';
        case 'email':
          return 'user@example.com';
        case 'uri':
          return 'https://example.com';
        default:
          return 'string';
      }
    default:
      return null;
  }
}

function asText(value: unknown): string {
  if (value === undefined || value === null) return '';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

// ---------------------------------------------------------------------------
// Conversion
// ---------------------------------------------------------------------------

interface Variables {
  readonly list: EnvironmentVariable[];
  add(name: string, value: string, secret: boolean): void;
}

function createVariables(): Variables {
  const list: EnvironmentVariable[] = [];
  return {
    list,
    add(name, value, secret) {
      if (!list.some((v) => v.name === name)) list.push({ id: newId(), name, value, enabled: true, secret });
    },
  };
}

function baseUrl(document: JsonRecord): string {
  if (typeof document['openapi'] === 'string') {
    const server = readRecords(document['servers'])[0];
    if (!server) return '';
    const variables = isRecord(server['variables']) ? server['variables'] : {};
    return readString(server['url']).replace(/\{([^}]+)\}/g, (match, name: string) => {
      const definition = variables[name];
      return isRecord(definition) && typeof definition['default'] === 'string' ? definition['default'] : match;
    });
  }
  const host = readString(document['host']);
  if (host === '') return '';
  const scheme = readList(document['schemes']).find((s): s is string => s === 'https' || s === 'http') ?? 'https';
  return `${scheme}://${host}${readString(document['basePath'])}`.replace(/\/$/, '');
}

function toKeyValue(key: string, value: string, enabled: boolean): KeyValue {
  return { id: newId(), key, value, enabled };
}

/** Reads a parameter's example, default or first enum value as text. */
function parameterValue(parameter: JsonRecord, resolver: Resolver): string {
  const schema = resolver.resolve(parameter['schema'] ?? parameter);
  const value = parameter['example'] ?? schema['example'] ?? schema['default'] ?? readList(schema['enum'])[0];
  return asText(value);
}

function readSecurity(
  document: JsonRecord,
  operation: JsonRecord,
  resolver: Resolver,
  variables: Variables,
  notes: ImportNotes,
): AuthConfig {
  const requirements = Array.isArray(operation['security']) ? operation['security'] : document['security'];
  const first = readRecords(requirements).find((r) => Object.keys(r).length > 0);
  if (!first) return { type: 'none' };
  const schemeName = Object.keys(first)[0];
  const schemes = resolverSchemes(document, resolver);
  const scheme = schemes[schemeName];
  if (!isRecord(scheme)) return { type: 'none' };

  const type = readString(scheme['type']);
  const httpScheme = readString(scheme['scheme']).toLowerCase();
  if (type === 'http' && httpScheme === 'bearer') {
    variables.add('token', '', true);
    return { type: 'bearer', token: '{{token}}' };
  }
  if ((type === 'http' && httpScheme === 'basic') || type === 'basic') {
    variables.add('username', '', false);
    variables.add('password', '', true);
    return { type: 'basic', username: '{{username}}', password: '{{password}}' };
  }
  if (type === 'apiKey' && (scheme['in'] === 'header' || scheme['in'] === 'query')) {
    variables.add('apiKey', '', true);
    return { type: 'apiKey', key: readString(scheme['name']), value: '{{apiKey}}', placement: scheme['in'] };
  }
  if (type === 'oauth2') {
    const code = readAuthorizationCodeFlow(scheme);
    if (code) {
      variables.add('clientId', '', false);
      const scopes = readList(first[schemeName]).filter((s): s is string => typeof s === 'string');
      return { type: 'oauth2', authorizationUrl: code.authorizationUrl, tokenUrl: code.tokenUrl, clientId: '{{clientId}}', scope: scopes.join(' ') };
    }
    notes.add('Only the OAuth 2.0 Authorization Code flow is supported. Requests using another OAuth flow have no authorization set.');
    return { type: 'none' };
  }
  notes.add(`Authorization of type "${type || 'unknown'}" is not imported. Requests that use it have no authorization set.`);
  return { type: 'none' };
}

/** The Authorization Code flow of an OAuth 2.0 scheme (OpenAPI 3 `flows.authorizationCode`, Swagger 2 `accessCode`). */
function readAuthorizationCodeFlow(scheme: JsonRecord): { authorizationUrl: string; tokenUrl: string } | null {
  const flows = isRecord(scheme['flows']) ? scheme['flows'] : null;
  const flow = flows ? flows['authorizationCode'] : scheme['flow'] === 'accessCode' ? scheme : null;
  if (!isRecord(flow)) return null;
  const authorizationUrl = readString(flow['authorizationUrl']);
  const tokenUrl = readString(flow['tokenUrl']);
  return authorizationUrl !== '' && tokenUrl !== '' ? { authorizationUrl, tokenUrl } : null;
}

function resolverSchemes(document: JsonRecord, resolver: Resolver): JsonRecord {
  const components = resolver.resolve(document['components']);
  const defs = isRecord(components['securitySchemes']) ? components['securitySchemes'] : document['securityDefinitions'];
  return isRecord(defs) ? defs : {};
}

function pickMediaType(types: readonly string[]): string | undefined {
  return (
    types.find((t) => t === 'application/json') ??
    types.find((t) => /^application\/(.+\+)?json/.test(t)) ??
    types.find((t) => t === 'application/x-www-form-urlencoded') ??
    types.find((t) => t === 'multipart/form-data') ??
    types.find((t) => /xml/.test(t)) ??
    types.find((t) => t.startsWith('text/')) ??
    types[0]
  );
}

function bodyFromSchema(mediaType: string, schema: unknown, example: unknown, resolver: Resolver): RequestBody {
  const budget = { left: MAX_EXAMPLE_NODES };
  const value = example !== undefined ? example : exampleFromSchema(schema, resolver, budget);

  if (mediaType === 'application/x-www-form-urlencoded' || mediaType === 'multipart/form-data') {
    const properties = resolver.resolve(schema)['properties'];
    const entries = isRecord(properties) ? Object.entries(properties) : [];
    if (mediaType === 'application/x-www-form-urlencoded') {
      return {
        type: 'urlencoded',
        fields: entries.map(([name, prop]) => toKeyValue(name, asText(exampleFromSchema(prop, resolver, budget)), true)),
      };
    }
    return {
      type: 'multipart',
      fields: entries.map(([name, prop]): FormDataField => {
        const isFile = readString(resolver.resolve(prop)['format']) === 'binary';
        return {
          id: newId(),
          key: name,
          enabled: true,
          kind: isFile ? 'file' : 'text',
          value: isFile ? '' : asText(exampleFromSchema(prop, resolver, budget)),
          ...(isFile ? { file: { name: '', size: 0, mimeType: '' } } : {}),
        };
      }),
    };
  }
  if (mediaType === 'application/octet-stream') return { type: 'binary' };
  if (/json/.test(mediaType)) return { type: 'text', language: 'json', content: JSON.stringify(value ?? {}, null, 2) };
  if (/xml/.test(mediaType)) return { type: 'text', language: 'xml', content: typeof value === 'string' ? value : '' };
  return { type: 'text', language: 'text', content: asText(value) };
}

function readBody(
  document: JsonRecord,
  operation: JsonRecord,
  parameters: readonly JsonRecord[],
  resolver: Resolver,
): RequestBody {
  if (typeof document['openapi'] === 'string') {
    const body = resolver.resolve(operation['requestBody']);
    const content = isRecord(body['content']) ? body['content'] : {};
    const mediaType = pickMediaType(Object.keys(content));
    if (mediaType === undefined) return { type: 'none' };
    const media = resolver.resolve(content[mediaType]);
    const examples = isRecord(media['examples']) ? Object.values(media['examples']) : [];
    const firstExample = isRecord(examples[0]) ? examples[0]['value'] : undefined;
    return bodyFromSchema(mediaType, media['schema'], media['example'] ?? firstExample, resolver);
  }
  // Swagger 2.0
  const consumes = [...readList(operation['consumes']), ...readList(document['consumes'])].filter((c): c is string => typeof c === 'string');
  const bodyParameter = parameters.find((p) => p['in'] === 'body');
  const formParameters = parameters.filter((p) => p['in'] === 'formData');
  if (bodyParameter) return bodyFromSchema(pickMediaType(consumes) ?? 'application/json', bodyParameter['schema'], undefined, resolver);
  if (formParameters.length > 0) {
    const multipart = formParameters.some((p) => p['type'] === 'file') || consumes.includes('multipart/form-data');
    const properties = Object.fromEntries(formParameters.map((p) => [readString(p['name']), p['type'] === 'file' ? { type: 'string', format: 'binary' } : p]));
    return bodyFromSchema(multipart ? 'multipart/form-data' : 'application/x-www-form-urlencoded', { properties }, undefined, resolver);
  }
  return { type: 'none' };
}

/**
 * Converts an OpenAPI 3.x or Swagger 2.0 document (already parsed from JSON)
 * into a collection: one folder per tag, one request per operation, and an
 * environment holding `baseUrl` and the variables the requests refer to.
 */
export function readOpenApi(document: unknown, now = Date.now()): ImportBundle {
  if (!isOpenApiDocument(document)) throw new ImportError('This is not an OpenAPI or Swagger 2.0 description.');
  if (typeof document['openapi'] === 'string' && !document['openapi'].startsWith('3.')) {
    throw new ImportError(`OpenAPI version ${document['openapi']} is not supported. Versions 3.x and Swagger 2.0 are.`);
  }
  const notes = new ImportNotes();
  const resolver = new Resolver(document, notes);
  const stamp = { schemaVersion: SCHEMA_VERSION, createdAt: now, updatedAt: now };
  const info = isRecord(document['info']) ? document['info'] : {};
  const title = cleanName(readString(info['title']), 'Imported API');
  const variables = createVariables();
  variables.add('baseUrl', baseUrl(document), false);

  const collection: Collection = { id: newId(), ...stamp, name: title, description: readString(info['description']), sortOrder: 0 };
  const folders = new Map<string, Folder>();
  const requests: SavedRequest[] = [];
  const paths = isRecord(document['paths']) ? document['paths'] : {};

  for (const [path, rawItem] of Object.entries(paths)) {
    if (!path.startsWith('/')) continue;
    const item = resolver.resolve(rawItem);
    for (const method of METHODS) {
      if (!isRecord(item[method])) continue;
      const operation = item[method] as JsonRecord;

      // Path-level parameters apply unless the operation redefines them.
      const merged = new Map<string, JsonRecord>();
      for (const raw of [...readList(item['parameters']), ...readList(operation['parameters'])]) {
        const parameter = resolver.resolve(raw);
        merged.set(`${readString(parameter['in'])}:${readString(parameter['name'])}`, parameter);
      }
      const parameters = [...merged.values()];

      const queryAndHeaders: KeyValue[] = [];
      const headers: KeyValue[] = [];
      for (const parameter of parameters) {
        const name = readString(parameter['name']);
        if (name === '') continue;
        const required = parameter['required'] === true;
        if (parameter['in'] === 'query') queryAndHeaders.push(toKeyValue(name, parameterValue(parameter, resolver), required));
        else if (parameter['in'] === 'header' && !SKIPPED_HEADER_PARAMS.has(name.toLowerCase())) {
          headers.push(toKeyValue(name, parameterValue(parameter, resolver), required));
        } else if (parameter['in'] === 'cookie') notes.add('Cookie parameters are not imported: browsers do not let scripts set cookies.');
      }

      const url = buildUrl(`{{baseUrl}}${path.replace(/\{([^}]+)\}/g, '{{$1}}')}`, queryAndHeaders);
      const tag = readString(readList(operation['tags'])[0]);
      let folderId: string | null = null;
      if (tag !== '') {
        let folder = folders.get(tag);
        if (!folder) {
          folder = { id: newId(), ...stamp, name: cleanName(tag, 'Untagged'), collectionId: collection.id, parentId: null, sortOrder: folders.size };
          folders.set(tag, folder);
        }
        folderId = folder.id;
      }

      const definition: RequestDefinition = {
        ...createEmptyRequest(),
        method: method.toUpperCase(),
        url,
        params: queryAndHeaders,
        headers,
        auth: readSecurity(document, operation, resolver, variables, notes),
        body: method === 'get' || method === 'head' ? { type: 'none' } : readBody(document, operation, parameters, resolver),
      };
      const name = readString(operation['summary']) || readString(operation['operationId']) || `${method.toUpperCase()} ${path}`;
      requests.push({
        id: newId(),
        ...stamp,
        name: cleanName(name, `${method.toUpperCase()} ${path}`),
        collectionId: collection.id,
        folderId,
        sortOrder: requests.length,
        definition,
      });
    }
    if (isRecord(item['trace'])) notes.add('TRACE operations are not imported: browsers cannot send TRACE requests.');
  }

  if (requests.length === 0) notes.add('The description contains no operations to import.');
  const environment: Environment = {
    id: newId(),
    ...stamp,
    name: cleanName(`${title} environment`, 'Imported environment'),
    variables: variables.list,
  };
  if (requests.some((r) => r.definition.body.type !== 'none')) {
    notes.add('Request bodies were generated from the schemas as examples. Review them before sending.');
  }
  return { collections: [collection], folders: [...folders.values()], requests, environments: [environment], warnings: notes.toArray() };
}
