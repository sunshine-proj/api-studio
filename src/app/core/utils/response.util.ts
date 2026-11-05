export type BodyKind = 'json' | 'xml' | 'html' | 'text' | 'image' | 'binary';

/** Most response bytes kept in memory; anything beyond is cut off and flagged. */
export const MAX_RESPONSE_BYTES = 50 * 1024 * 1024;

/** Largest body rendered in the viewer. Bigger bodies can only be downloaded. */
export const MAX_RENDERED_BYTES = 10 * 1024 * 1024;

function mimeOf(contentType: string | null): string {
  return (contentType ?? '').split(';')[0].trim().toLowerCase();
}

export function detectBodyKind(contentType: string | null): BodyKind {
  const mime = mimeOf(contentType);
  if (mime === 'application/json' || mime.endsWith('+json')) return 'json';
  if (mime === 'text/html' || mime === 'application/xhtml+xml') return 'html';
  if (mime === 'application/xml' || mime === 'text/xml' || mime.endsWith('+xml')) return 'xml';
  if (mime.startsWith('image/')) return 'image';
  if (
    mime.startsWith('text/') ||
    mime === 'application/javascript' ||
    mime === 'application/x-www-form-urlencoded' ||
    mime === ''
  ) {
    return 'text';
  }
  return 'binary';
}

const REASON_PHRASES: Readonly<Record<number, string>> = {
  200: 'OK', 201: 'Created', 202: 'Accepted', 204: 'No Content', 206: 'Partial Content',
  301: 'Moved Permanently', 302: 'Found', 303: 'See Other', 304: 'Not Modified',
  307: 'Temporary Redirect', 308: 'Permanent Redirect',
  400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found',
  405: 'Method Not Allowed', 408: 'Request Timeout', 409: 'Conflict', 410: 'Gone',
  415: 'Unsupported Media Type', 422: 'Unprocessable Content', 429: 'Too Many Requests',
  500: 'Internal Server Error', 501: 'Not Implemented', 502: 'Bad Gateway',
  503: 'Service Unavailable', 504: 'Gateway Timeout',
};

/** HTTP/2 and HTTP/3 responses have no status text; fall back to the standard phrase. */
export function statusDescription(status: number, statusText: string): string {
  return statusText !== '' ? statusText : (REASON_PHRASES[status] ?? '');
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDuration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
}

/** Decodes bytes using the charset from the content type, defaulting to UTF-8. */
export async function decodeBody(blob: Blob, contentType: string | null): Promise<string> {
  const charset = /charset\s*=\s*"?([^";\s]+)/i.exec(contentType ?? '')?.[1];
  const buffer = await blob.arrayBuffer();
  try {
    return new TextDecoder(charset ?? 'utf-8').decode(buffer);
  } catch {
    return new TextDecoder('utf-8').decode(buffer);
  }
}

/** Returns formatted JSON, or null when the text is not valid JSON. */
export function prettyPrintJson(text: string): string | null {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return null;
  }
}
