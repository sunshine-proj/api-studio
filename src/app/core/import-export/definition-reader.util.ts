import {
  Assertion,
  AssertionOperator,
  AssertionTarget,
  AuthConfig,
  CredentialsMode,
  Extraction,
  ExtractionSource,
  DEFAULT_REQUEST_OPTIONS,
  FileReference,
  FormDataField,
  KeyValue,
  RedirectMode,
  RequestBody,
  RequestDefinition,
  RequestScripts,
  TextBodyLanguage,
} from '../models';
import { newId } from '../utils/id';
import { ImportNotes, JsonRecord, isRecord, readBoolean, readNumber, readOneOf, readRecords, readString } from './reading.util';

const LANGUAGES: readonly TextBodyLanguage[] = ['json', 'xml', 'text', 'javascript'];
const REDIRECTS: readonly RedirectMode[] = ['follow', 'manual', 'error'];
const CREDENTIALS: readonly CredentialsMode[] = ['omit', 'same-origin', 'include'];
const TARGETS: readonly AssertionTarget[] = ['status', 'header', 'json', 'body', 'duration'];
const OPERATORS: readonly AssertionOperator[] = [
  'equals', 'not-equals', 'contains', 'not-contains', 'matches', 'exists', 'not-exists', 'less-than', 'greater-than',
];
const SOURCES: readonly ExtractionSource[] = ['json', 'header', 'status', 'regex'];
const METHOD = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]{1,40}$/;

export function readKeyValues(value: unknown): readonly KeyValue[] {
  return readRecords(value).map((row) => ({
    id: newId(),
    key: readString(row['key']),
    value: readString(row['value']),
    enabled: readBoolean(row['enabled'], true),
  }));
}

function readFileReference(value: unknown): FileReference | undefined {
  if (!isRecord(value)) return undefined;
  return {
    name: readString(value['name']).slice(0, 255),
    size: readNumber(value['size'], 0),
    mimeType: readString(value['mimeType']).slice(0, 255),
  };
}

function readAuth(value: unknown, notes: ImportNotes): AuthConfig {
  if (!isRecord(value)) return { type: 'none' };
  switch (value['type']) {
    case 'basic':
      return { type: 'basic', username: readString(value['username']), password: readString(value['password']) };
    case 'bearer':
      return { type: 'bearer', token: readString(value['token']) };
    case 'apiKey':
      return {
        type: 'apiKey',
        key: readString(value['key']),
        value: readString(value['value']),
        placement: readOneOf(value['placement'], ['header', 'query'] as const, 'header'),
      };
    case 'custom':
      return { type: 'custom', headerName: readString(value['headerName']), headerValue: readString(value['headerValue']) };
    case 'oauth2':
      return {
        type: 'oauth2',
        authorizationUrl: readString(value['authorizationUrl']),
        tokenUrl: readString(value['tokenUrl']),
        clientId: readString(value['clientId']),
        scope: readString(value['scope']),
      };
    case 'none':
      return { type: 'none' };
    default:
      notes.add('A request with an unknown authorization type was imported without authorization.');
      return { type: 'none' };
  }
}

function readBody(value: unknown, notes: ImportNotes): RequestBody {
  if (!isRecord(value)) return { type: 'none' };
  switch (value['type']) {
    case 'text':
      return {
        type: 'text',
        language: readOneOf(value['language'], LANGUAGES, 'text'),
        content: readString(value['content']),
      };
    case 'urlencoded':
      return { type: 'urlencoded', fields: readKeyValues(value['fields']) };
    case 'multipart':
      return {
        type: 'multipart',
        fields: readRecords(value['fields']).map((field): FormDataField => {
          const file = readFileReference(field['file']);
          const isFile = field['kind'] === 'file' && file !== undefined;
          return {
            id: newId(),
            key: readString(field['key']),
            enabled: readBoolean(field['enabled'], true),
            kind: isFile ? 'file' : 'text',
            value: readString(field['value']),
            ...(isFile ? { file } : {}),
          };
        }),
      };
    case 'binary':
      return { type: 'binary', file: readFileReference(value['file']) };
    case 'graphql':
      return {
        type: 'graphql',
        query: readString(value['query']),
        variables: readString(value['variables']),
        operationName: readString(value['operationName']),
      };
    case 'none':
      return { type: 'none' };
    default:
      notes.add('A request with an unknown body type was imported without a body.');
      return { type: 'none' };
  }
}

function readAssertions(value: unknown): readonly Assertion[] {
  return readRecords(value).map((row) => ({
    id: newId(),
    enabled: readBoolean(row['enabled'], true),
    target: readOneOf(row['target'], TARGETS, 'status'),
    property: readString(row['property']),
    operator: readOneOf(row['operator'], OPERATORS, 'equals'),
    expected: readString(row['expected']),
  }));
}

function readExtractions(value: unknown): readonly Extraction[] {
  return readRecords(value).map((row) => ({
    id: newId(),
    enabled: readBoolean(row['enabled'], true),
    variable: readString(row['variable']),
    source: readOneOf(row['source'], SOURCES, 'json'),
    expression: readString(row['expression']),
    secret: readBoolean(row['secret'], false),
  }));
}

/**
 * Imported scripts are kept so they can be reviewed, but always switched off:
 * an imported file must never cause code to run without the user's say-so.
 */
function readScripts(value: unknown, notes: ImportNotes): RequestScripts | undefined {
  if (!isRecord(value)) return undefined;
  const preRequest = readString(value['preRequest']);
  const test = readString(value['test']);
  if (preRequest.trim() === '' && test.trim() === '') return undefined;
  notes.add('Some requests contain scripts. They were imported switched off. Review them in the Scripts tab before enabling them.');
  return { enabled: false, preRequest, test };
}

/**
 * Rebuilds a request definition from untrusted data using only known fields.
 * Returns null when it is not usable (no valid method). Row ids are regenerated.
 */
export function readDefinition(value: unknown, notes: ImportNotes): RequestDefinition | null {
  if (!isRecord(value)) return null;
  const method = readString(value['method']).trim().toUpperCase();
  if (!METHOD.test(method)) return null;
  const options: JsonRecord = isRecord(value['options']) ? value['options'] : {};
  const assertions = readAssertions(value['assertions']);
  const extractions = readExtractions(value['extractions']);
  const scripts = readScripts(value['scripts'], notes);
  return {
    method,
    url: readString(value['url']),
    params: readKeyValues(value['params']),
    headers: readKeyValues(value['headers']),
    auth: readAuth(value['auth'], notes),
    body: readBody(value['body'], notes),
    options: {
      timeoutMs: readNumber(options['timeoutMs'], DEFAULT_REQUEST_OPTIONS.timeoutMs, 0, 24 * 60 * 60 * 1000),
      redirect: readOneOf(options['redirect'], REDIRECTS, DEFAULT_REQUEST_OPTIONS.redirect),
      credentials: readOneOf(options['credentials'], CREDENTIALS, DEFAULT_REQUEST_OPTIONS.credentials),
    },
    ...(assertions.length > 0 ? { assertions } : {}),
    ...(extractions.length > 0 ? { extractions } : {}),
    ...(scripts ? { scripts } : {}),
  };
}

/** Warns about URLs that can never be sent from a browser (anything but http/https, ignoring `{{variables}}`). */
export function warnAboutUrl(url: string, notes: ImportNotes): void {
  const scheme = /^\s*([a-z][a-z0-9+.-]*):/i.exec(url)?.[1]?.toLowerCase();
  if (scheme !== undefined && scheme !== 'http' && scheme !== 'https') {
    notes.add(`Some requests use a "${scheme}:" address, which this app cannot send.`);
  }
}
