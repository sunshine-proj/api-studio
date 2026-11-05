import { KeyValue } from '../models';
import { newId } from './id';

const PLACEHOLDER_SPLIT = /(\{\{[^{}]*\}\})/;

export interface UrlParts {
  /** Everything before `?` or `#`. */
  readonly base: string;
  /** Query string without the leading `?`, or null when there is none. */
  readonly query: string | null;
  /** Fragment including the leading `#`, or an empty string. */
  readonly hash: string;
}

export function splitUrl(url: string): UrlParts {
  const hashIndex = url.indexOf('#');
  const hash = hashIndex === -1 ? '' : url.slice(hashIndex);
  const withoutHash = hashIndex === -1 ? url : url.slice(0, hashIndex);
  const queryIndex = withoutHash.indexOf('?');
  if (queryIndex === -1) {
    return { base: withoutHash, query: null, hash };
  }
  return { base: withoutHash.slice(0, queryIndex), query: withoutHash.slice(queryIndex + 1), hash };
}

/** Percent-encodes a query component while leaving `{{variables}}` readable. */
export function encodeQueryComponent(text: string): string {
  return text
    .split(PLACEHOLDER_SPLIT)
    .map((part, index) => (index % 2 === 1 ? part : encodeURIComponent(part)))
    .join('');
}

/** Decodes percent-escapes, keeping the original text when it is malformed. */
export function decodeQueryComponent(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

export interface ParsedParam {
  readonly key: string;
  readonly value: string;
}

export function parseQuery(query: string): readonly ParsedParam[] {
  const result: ParsedParam[] = [];
  for (const segment of query.split('&')) {
    if (segment === '') {
      continue;
    }
    const separator = segment.indexOf('=');
    const key = separator === -1 ? segment : segment.slice(0, separator);
    const value = separator === -1 ? '' : segment.slice(separator + 1);
    result.push({ key: decodeQueryComponent(key), value: decodeQueryComponent(value) });
  }
  return result;
}

function isBlank(param: KeyValue): boolean {
  return param.key === '' && param.value === '';
}

/** Rebuilds the URL from its base and the enabled, non-blank parameters. */
export function buildUrl(url: string, params: readonly KeyValue[]): string {
  const { base, hash } = splitUrl(url);
  const pairs = params
    .filter((param) => param.enabled && !isBlank(param))
    .map((param) => `${encodeQueryComponent(param.key)}=${encodeQueryComponent(param.value)}`);
  return `${base}${pairs.length > 0 ? `?${pairs.join('&')}` : ''}${hash}`;
}

/**
 * Updates the parameter table after the URL text changed. Enabled rows take the
 * parsed values in order (keeping their ids), disabled rows are left alone and
 * extra parsed values become new rows.
 */
export function paramsFromUrl(url: string, existing: readonly KeyValue[]): readonly KeyValue[] {
  const { query } = splitUrl(url);
  const parsed = query === null ? [] : parseQuery(query);
  const result: KeyValue[] = [];
  let next = 0;
  for (const param of existing) {
    if (!param.enabled) {
      result.push(param);
    } else if (next < parsed.length) {
      const source = parsed[next++];
      result.push({ ...param, key: source.key, value: source.value });
    }
  }
  for (; next < parsed.length; next++) {
    result.push({ id: newId(), key: parsed[next].key, value: parsed[next].value, enabled: true });
  }
  return result;
}

export type UrlValidation =
  | { readonly ok: true; readonly url: URL }
  | { readonly ok: false; readonly reason: string };

/** Validates a fully resolved URL. Only http and https are executable. */
export function validateUrl(text: string): UrlValidation {
  const trimmed = text.trim();
  if (trimmed === '') {
    return { ok: false, reason: 'Enter a URL.' };
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, reason: 'The URL is not valid. Start it with http:// or https://.' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: 'Only http: and https: URLs are supported.' };
  }
  return { ok: true, url };
}
