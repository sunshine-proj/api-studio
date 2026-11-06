import { KeyValue, RequestDefinition } from '../models';
import { newId } from '../utils/id';
import { paramsFromUrl } from '../utils/url.util';
import { ScriptRequestView } from './script.model';

/** The request as a script should see it: unresolved (`{{variables}}` intact), enabled headers only. */
export function toScriptRequest(definition: RequestDefinition): ScriptRequestView {
  const headers: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const header of definition.headers) {
    if (header.enabled && header.key.trim() !== '') headers[header.key] = header.value;
  }
  return {
    method: definition.method,
    url: definition.url,
    headers: { ...headers },
    body: definition.body.type === 'text' ? definition.body.content : null,
  };
}

/**
 * Applies what a pre-request script changed to a copy of the request: method,
 * URL (the parameter table follows it), headers (changed, added or removed by
 * name) and the text body. Disabled headers and everything else are left alone.
 */
export function applyScriptRequest(definition: RequestDefinition, view: ScriptRequestView): RequestDefinition {
  const wanted = new Map<string, { key: string; value: string }>();
  for (const [key, value] of Object.entries(view.headers)) wanted.set(key.toLowerCase(), { key, value });

  const seen = new Set<string>();
  const headers: KeyValue[] = [];
  for (const header of definition.headers) {
    const lower = header.key.toLowerCase();
    if (!header.enabled) {
      headers.push(header);
    } else if (wanted.has(lower)) {
      seen.add(lower);
      headers.push({ ...header, value: wanted.get(lower)!.value });
    } // an enabled header the script removed is dropped
  }
  for (const [lower, { key, value }] of wanted) {
    if (!seen.has(lower)) headers.push({ id: newId(), key, value, enabled: true });
  }

  let body = definition.body;
  if (view.body !== null) {
    if (body.type === 'text') body = { ...body, content: view.body };
    else if (body.type === 'none' && view.body !== '') body = { type: 'text', language: 'text', content: view.body };
  }

  return {
    ...definition,
    method: view.method.trim() || definition.method,
    url: view.url,
    params: paramsFromUrl(view.url, definition.params),
    headers,
    body,
  };
}
