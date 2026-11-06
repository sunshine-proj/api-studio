import {
  AuthConfig,
  PreparationResult,
  PreparedBody,
  PreparedFormField,
  PreparedHeader,
  RequestBody,
  RequestDefinition,
  TextBodyLanguage,
} from '../models';
import { hasHeader, headerProblem, prepareHeaders } from './header.util';
import { validateUrl } from './url.util';
import { resolveVariables, VariableMap } from './variable.util';

const METHOD_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
/** Methods the Fetch standard normalizes to upper case. */
const NORMALIZED_METHODS: ReadonlySet<string> = new Set(['DELETE', 'GET', 'HEAD', 'OPTIONS', 'POST', 'PUT']);
const FORBIDDEN_METHODS: ReadonlySet<string> = new Set(['CONNECT', 'TRACE', 'TRACK']);
const METHODS_WITHOUT_BODY: ReadonlySet<string> = new Set(['GET', 'HEAD']);

const CONTENT_TYPES: Readonly<Record<TextBodyLanguage, string>> = {
  json: 'application/json',
  xml: 'application/xml',
  text: 'text/plain',
  javascript: 'application/javascript',
};
const URLENCODED_CONTENT_TYPE = 'application/x-www-form-urlencoded;charset=UTF-8';

/** Key under which the binary body's file is looked up in the files map. */
export const BINARY_FILE_KEY = 'binary';

/** User-selected files by id: multipart row id, or `BINARY_FILE_KEY`. Never persisted. */
export type FileMap = ReadonlyMap<string, Blob>;

/** Fetch normalizes standard methods only; custom and PATCH keep their case. */
export function normalizeMethod(method: string): string {
  const trimmed = method.trim();
  const upper = trimmed.toUpperCase();
  return NORMALIZED_METHODS.has(upper) || upper === 'PATCH' ? upper : trimmed;
}

/** Base64 of the UTF-8 bytes of a string (btoa alone only handles Latin-1). */
export function toBase64Utf8(text: string): string {
  let binary = '';
  for (const byte of new TextEncoder().encode(text)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function failure(message: string, warnings: readonly string[]): PreparationResult {
  return { ok: false, error: { kind: 'invalid-request', message }, warnings };
}

function removeHeader(headers: PreparedHeader[], name: string): boolean {
  const lower = name.toLowerCase();
  let removed = false;
  for (let index = headers.length - 1; index >= 0; index--) {
    if (headers[index].name.toLowerCase() === lower) {
      headers.splice(index, 1);
      removed = true;
    }
  }
  return removed;
}

/**
 * Turns a request definition into something sendable: validates the method and
 * URL, resolves environment variables, applies authorization and prepares
 * headers and the body. Pure function: no network or UI, so every executor
 * shares it.
 */
export function prepareRequest(
  definition: RequestDefinition,
  variables: VariableMap,
  files: FileMap = new Map(),
): PreparationResult {
  const warnings: string[] = [];
  const unresolved: string[] = [];

  const method = normalizeMethod(definition.method);
  if (!METHOD_TOKEN.test(method)) {
    return failure(`"${definition.method}" is not a valid HTTP method.`, warnings);
  }
  if (FORBIDDEN_METHODS.has(method.toUpperCase())) {
    return failure(`The ${method.toUpperCase()} method is forbidden in browsers.`, warnings);
  }

  const resolvedUrl = resolveVariables(definition.url, variables);
  unresolved.push(...resolvedUrl.unresolved);
  const validation = validateUrl(resolvedUrl.text);
  if (!validation.ok) {
    return failure(validation.reason, warnings);
  }
  const url = validation.url;

  const headerResult = prepareHeaders(definition.headers, variables);
  warnings.push(...headerResult.warnings);
  unresolved.push(...headerResult.unresolved);
  const headers: PreparedHeader[] = [...headerResult.headers];

  applyAuth(definition.auth, variables, headers, url, warnings, unresolved);

  const bodyResult = prepareBody(definition.body, method, variables, files, headers, warnings);
  if (bodyResult.kind === 'error') {
    return failure(bodyResult.message, warnings);
  }
  unresolved.push(...bodyResult.unresolved);

  for (const name of new Set(unresolved)) {
    warnings.push(`Variable {{${name}}} is not defined and was sent as written.`);
  }

  return {
    ok: true,
    request: { method, url: url.href, headers, body: bodyResult.body, options: definition.options },
    warnings,
  };
}

/** Sets a header, replacing user-defined ones of the same name (and saying so). */
function setAuthHeader(headers: PreparedHeader[], name: string, value: string, warnings: string[]): void {
  const problem = headerProblem(name, value);
  if (problem) {
    warnings.push(`Authorization header "${name}" was not sent: ${problem}.`);
    return;
  }
  if (removeHeader(headers, name)) {
    warnings.push(`The "${name}" header from the Headers tab was replaced by the Authorization settings.`);
  }
  headers.push({ name, value });
}

function applyAuth(
  auth: AuthConfig,
  variables: VariableMap,
  headers: PreparedHeader[],
  url: URL,
  warnings: string[],
  unresolved: string[],
): void {
  const resolve = (text: string): string => {
    const result = resolveVariables(text, variables);
    unresolved.push(...result.unresolved);
    return result.text;
  };

  switch (auth.type) {
    case 'none':
      return;
    case 'basic': {
      const username = resolve(auth.username);
      const password = resolve(auth.password);
      if (username === '' && password === '') {
        warnings.push('Basic authentication has no username or password, so no Authorization header was sent.');
        return;
      }
      setAuthHeader(headers, 'Authorization', `Basic ${toBase64Utf8(`${username}:${password}`)}`, warnings);
      return;
    }
    case 'bearer': {
      const token = resolve(auth.token).trim();
      if (token === '') {
        warnings.push('The bearer token is empty, so no Authorization header was sent.');
        return;
      }
      setAuthHeader(headers, 'Authorization', `Bearer ${token}`, warnings);
      return;
    }
    case 'apiKey': {
      const key = resolve(auth.key).trim();
      const value = resolve(auth.value);
      if (key === '') {
        warnings.push('The API key name is empty, so it was not sent.');
      } else if (auth.placement === 'query') {
        url.searchParams.append(key, value);
      } else {
        setAuthHeader(headers, key, value, warnings);
      }
      return;
    }
    case 'custom': {
      const name = resolve(auth.headerName).trim();
      if (name === '') {
        warnings.push('The custom authorization header name is empty, so it was not sent.');
        return;
      }
      setAuthHeader(headers, name, resolve(auth.headerValue), warnings);
      return;
    }
  }
}

type BodyOutcome =
  | { readonly kind: 'ok'; readonly body: PreparedBody; readonly unresolved: readonly string[] }
  | { readonly kind: 'error'; readonly message: string };

function prepareBody(
  body: RequestBody,
  method: string,
  variables: VariableMap,
  files: FileMap,
  headers: PreparedHeader[],
  warnings: string[],
): BodyOutcome {
  if (body.type === 'none') {
    return { kind: 'ok', body: { type: 'none' }, unresolved: [] };
  }
  if (METHODS_WITHOUT_BODY.has(method.toUpperCase())) {
    warnings.push(`${method.toUpperCase()} requests cannot have a body. The body was not sent.`);
    return { kind: 'ok', body: { type: 'none' }, unresolved: [] };
  }

  const unresolved: string[] = [];
  const resolve = (text: string): string => {
    const result = resolveVariables(text, variables);
    unresolved.push(...result.unresolved);
    return result.text;
  };
  const defaultContentType = (value: string): void => {
    if (!hasHeader(headers, 'content-type')) {
      headers.push({ name: 'Content-Type', value });
    }
  };

  switch (body.type) {
    case 'text':
      defaultContentType(CONTENT_TYPES[body.language]);
      return { kind: 'ok', body: { type: 'text', content: resolve(body.content) }, unresolved };

    case 'graphql': {
      const query = resolve(body.query);
      if (query.trim() === '') {
        return { kind: 'error', message: 'The GraphQL query is empty.' };
      }
      const variablesText = resolve(body.variables);
      let variables: unknown;
      if (variablesText.trim() !== '') {
        try {
          variables = JSON.parse(variablesText);
        } catch {
          return { kind: 'error', message: 'The GraphQL variables are not valid JSON.' };
        }
        if (typeof variables !== 'object' || variables === null || Array.isArray(variables)) {
          return { kind: 'error', message: 'The GraphQL variables must be a JSON object.' };
        }
      }
      const operationName = resolve(body.operationName).trim();
      defaultContentType(CONTENT_TYPES.json);
      return {
        kind: 'ok',
        body: { type: 'text', content: JSON.stringify({ query, variables, operationName: operationName || undefined }) },
        unresolved,
      };
    }

    case 'urlencoded': {
      const pairs: [string, string][] = body.fields
        .filter((field) => field.enabled && !(field.key === '' && field.value === ''))
        .map((field) => [resolve(field.key), resolve(field.value)]);
      defaultContentType(URLENCODED_CONTENT_TYPE);
      return { kind: 'ok', body: { type: 'text', content: new URLSearchParams(pairs).toString() }, unresolved };
    }

    case 'multipart': {
      const fields: PreparedFormField[] = [];
      for (const field of body.fields) {
        if (!field.enabled) continue;
        const name = resolve(field.key);
        if (field.kind === 'file') {
          if (field.key === '' && !field.file) continue;
          const blob = files.get(field.id);
          if (!field.file || !blob) {
            return { kind: 'error', message: `The file for field "${name}" is not selected. Choose it again.` };
          }
          fields.push({ kind: 'file', name, blob, filename: field.file.name });
        } else if (!(field.key === '' && field.value === '')) {
          fields.push({ kind: 'text', name, value: resolve(field.value) });
        }
      }
      // The browser must generate the Content-Type, because it contains the boundary.
      if (removeHeader(headers, 'content-type')) {
        warnings.push('The Content-Type header was removed: the browser sets it, with a boundary, for multipart bodies.');
      }
      return { kind: 'ok', body: { type: 'multipart', fields }, unresolved };
    }

    case 'binary': {
      const blob = files.get(BINARY_FILE_KEY);
      if (!body.file || !blob) {
        return { kind: 'error', message: 'No file is selected for the binary body.' };
      }
      defaultContentType(blob.type || 'application/octet-stream');
      return { kind: 'ok', body: { type: 'binary', blob }, unresolved };
    }
  }
}
