import { KeyValue, PreparedHeader } from '../models';
import { resolveVariables, VariableMap } from './variable.util';

const FORBIDDEN_HEADERS: ReadonlySet<string> = new Set([
  'accept-charset',
  'accept-encoding',
  'access-control-request-headers',
  'access-control-request-method',
  'connection',
  'content-length',
  'cookie',
  'cookie2',
  'date',
  'dnt',
  'expect',
  'host',
  'keep-alive',
  'origin',
  'referer',
  'set-cookie',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'via',
]);

const TOKEN_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/** Headers that browsers do not let scripts set. */
export function isForbiddenHeader(name: string): boolean {
  const lower = name.toLowerCase();
  return FORBIDDEN_HEADERS.has(lower) || lower.startsWith('proxy-') || lower.startsWith('sec-');
}

export function isValidHeaderName(name: string): boolean {
  return TOKEN_PATTERN.test(name);
}

/** Returns why a header cannot be sent from a browser, or null when it can. */
export function headerProblem(name: string, value: string): string | null {
  if (!isValidHeaderName(name)) return 'it is not a valid header name';
  if (isForbiddenHeader(name)) return 'browsers do not allow scripts to set it';
  if (/[\r\n\0]/.test(value)) return 'its value contains a line break';
  return null;
}

export function hasHeader(headers: readonly PreparedHeader[], name: string): boolean {
  const lower = name.toLowerCase();
  return headers.some((header) => header.name.toLowerCase() === lower);
}

export interface HeaderPreparation {
  readonly headers: readonly PreparedHeader[];
  readonly warnings: readonly string[];
  readonly unresolved: readonly string[];
}

/**
 * Resolves variables and drops headers the browser would reject, reporting each
 * one instead of silently ignoring it. Duplicate names are preserved.
 */
export function prepareHeaders(rows: readonly KeyValue[], variables: VariableMap): HeaderPreparation {
  const headers: PreparedHeader[] = [];
  const warnings: string[] = [];
  const unresolved: string[] = [];

  for (const row of rows) {
    if (!row.enabled || (row.key === '' && row.value === '')) {
      continue;
    }
    const name = resolveVariables(row.key, variables);
    const value = resolveVariables(row.value, variables);
    unresolved.push(...name.unresolved, ...value.unresolved);
    const headerName = name.text.trim();

    const problem = headerProblem(headerName, value.text);
    if (problem) {
      warnings.push(`Header "${headerName}" was not sent: ${problem}.`);
    } else {
      headers.push({ name: headerName, value: value.text.trim() });
    }
  }
  return { headers, warnings, unresolved };
}
