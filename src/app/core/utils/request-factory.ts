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
