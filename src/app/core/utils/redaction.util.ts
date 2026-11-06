import { AuthConfig, KeyValue, RequestBody, RequestDefinition } from '../models';

/** Shown in place of a removed header value. */
export const REDACTED = '[redacted]';

/** Secrets shorter than this are not searched for: replacing a 1–3 character value would mangle ordinary text. */
export const MIN_SECRET_LENGTH = 4;

/** Text bodies longer than this are cut when stored in history. */
export const MAX_HISTORY_BODY_CHARS = 256 * 1024;

const SENSITIVE_HEADERS: ReadonlySet<string> = new Set(['authorization', 'proxy-authorization']);
const PLACEHOLDER = /\{\{[^{}]*\}\}/g;
const AUTH_SCHEME = /^(bearer|basic|token)\s+/i;

export interface SecretVariable {
  readonly name: string;
  readonly value: string;
}

/** A value made only of `{{variable}}` placeholders (optionally after an auth scheme) holds no secret. */
function holdsOnlyPlaceholders(value: string): boolean {
  return value.replace(PLACEHOLDER, '').replace(AUTH_SCHEME, '').trim() === '';
}

/**
 * Returns a copy of a request that is safe to keep in history:
 *
 * - `Authorization` and `Proxy-Authorization` header values are replaced by
 *   `[redacted]`, and credentials in the auth settings are emptied, unless
 *   they consist only of `{{variable}}` placeholders (which hold no secret).
 * - Wherever the value of a variable marked secret appears literally (URL,
 *   params, headers, body), it is replaced by that variable's `{{name}}`, so
 *   reopening the request still works. Values shorter than
 *   `MIN_SECRET_LENGTH` are not searched for.
 *
 * Secrets typed directly into a body field, an assertion or a script under
 * another name cannot be recognized; the UI says that history is not a place
 * for secrets.
 */
export function redactDefinition(definition: RequestDefinition, secrets: readonly SecretVariable[]): RequestDefinition {
  const searchable = secrets
    .filter((secret) => secret.value.length >= MIN_SECRET_LENGTH)
    .sort((a, b) => b.value.length - a.value.length); // longest first, so a secret containing another is replaced whole

  const scrub = (text: string): string =>
    searchable.reduce((result, secret) => result.split(secret.value).join(`{{${secret.name}}}`), text);
  const credential = (value: string): string => (holdsOnlyPlaceholders(value) ? scrub(value) : '');

  const pairs = (items: readonly KeyValue[]): readonly KeyValue[] =>
    items.map((item) => ({ ...item, key: scrub(item.key), value: scrub(item.value) }));

  const auth = ((): AuthConfig => {
    const config = definition.auth;
    switch (config.type) {
      case 'none':
      case 'oauth2': // a public client: nothing secret is stored (the token is kept in memory only)
        return config;
      case 'basic':
        return { ...config, username: scrub(config.username), password: credential(config.password) };
      case 'bearer':
        return { ...config, token: credential(config.token) };
      case 'apiKey':
        return { ...config, key: scrub(config.key), value: credential(config.value) };
      case 'custom':
        return { ...config, headerName: scrub(config.headerName), headerValue: credential(config.headerValue) };
    }
  })();

  const body = ((): RequestBody => {
    const current = definition.body;
    switch (current.type) {
      case 'none':
      case 'binary':
        return current;
      case 'text':
        return { ...current, content: scrub(current.content) };
      case 'graphql':
        return { ...current, query: scrub(current.query), variables: scrub(current.variables) };
      case 'urlencoded':
        return { ...current, fields: pairs(current.fields) };
      case 'multipart':
        return {
          ...current,
          fields: current.fields.map((field) => ({ ...field, key: scrub(field.key), value: scrub(field.value) })),
        };
    }
  })();

  return {
    ...definition,
    url: scrub(definition.url),
    params: pairs(definition.params),
    headers: definition.headers.map((header) => ({
      ...header,
      key: scrub(header.key),
      value:
        SENSITIVE_HEADERS.has(header.key.trim().toLowerCase()) && !holdsOnlyPlaceholders(header.value)
          ? REDACTED
          : scrub(header.value),
    })),
    auth,
    body,
    ...(definition.assertions
      ? { assertions: definition.assertions.map((a) => ({ ...a, property: scrub(a.property), expected: scrub(a.expected) })) }
      : {}),
    ...(definition.scripts
      ? { scripts: { ...definition.scripts, preRequest: scrub(definition.scripts.preRequest), test: scrub(definition.scripts.test) } }
      : {}),
  };
}

/** Cuts a very large text body. Returns the (possibly shortened) request and whether it was cut. */
export function limitBodySize(
  definition: RequestDefinition,
  maxChars = MAX_HISTORY_BODY_CHARS,
): { readonly definition: RequestDefinition; readonly truncated: boolean } {
  const body = definition.body;
  if (body.type !== 'text' || body.content.length <= maxChars) {
    return { definition, truncated: false };
  }
  return { definition: { ...definition, body: { ...body, content: body.content.slice(0, maxChars) } }, truncated: true };
}
