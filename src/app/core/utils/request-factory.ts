import { DEFAULT_REQUEST_OPTIONS, RequestDefinition } from '../models';

export function createEmptyRequest(): RequestDefinition {
  return {
    method: 'GET',
    url: '',
    params: [],
    headers: [],
    auth: { type: 'none' },
    body: { type: 'none' },
    options: DEFAULT_REQUEST_OPTIONS,
  };
}

/** True when two definitions would send the same request (used to detect unsaved changes). */
export function sameDefinition(a: RequestDefinition, b: RequestDefinition): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}
