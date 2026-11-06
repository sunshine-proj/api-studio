import { RequestDefinition } from '../models';

/** Suggests a name for a new saved request from its method and URL, e.g. "GET /users/42". */
export function suggestRequestName(definition: RequestDefinition): string {
  const url = definition.url.trim();
  if (url === '') return 'New request';
  let label: string;
  try {
    // Placeholders such as {{baseUrl}} are not valid URLs, so only parse when it works.
    const parsed = new URL(url);
    label = parsed.pathname === '/' ? parsed.host : parsed.pathname;
  } catch {
    label = url.replace(/^\{\{[^}]*\}\}/, '').split(/[?#]/)[0] || url;
  }
  return `${definition.method.toUpperCase()} ${label}`.slice(0, 120);
}
