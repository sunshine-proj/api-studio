/** Extracts a file name from a Content-Disposition header value, if present. */
export function filenameFromDisposition(disposition: string | null): string | null {
  if (!disposition) return null;
  const encoded = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(disposition)?.[1];
  if (encoded) {
    try {
      return sanitizeFilename(decodeURIComponent(encoded));
    } catch {
      /* fall through to the plain form */
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(disposition)?.[1];
  return plain ? sanitizeFilename(plain) : null;
}

const EXTENSIONS: Readonly<Record<string, string>> = {
  'application/json': '.json',
  'application/xml': '.xml',
  'text/xml': '.xml',
  'text/html': '.html',
  'text/plain': '.txt',
  'text/css': '.css',
  'text/csv': '.csv',
  'application/javascript': '.js',
  'application/pdf': '.pdf',
  'application/zip': '.zip',
  'application/gzip': '.gz',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'image/avif': '.avif',
};

/**
 * Chooses a file name for a downloaded response: the server's suggestion
 * (Content-Disposition), else the last part of the URL path, else "response".
 * A name without an extension gets one from the content type when it is known.
 */
export function suggestFilename(disposition: string | null, url: string, contentType: string | null): string {
  const fromHeader = filenameFromDisposition(disposition);
  const name = fromHeader ?? lastPathSegment(url) ?? 'response';
  if (/\.[A-Za-z0-9]{1,8}$/.test(name)) return name;
  const mime = (contentType ?? '').split(';')[0].trim().toLowerCase();
  const extension = EXTENSIONS[mime] ?? (mime.endsWith('+json') ? '.json' : mime.endsWith('+xml') ? '.xml' : mime === '' ? '' : '.bin');
  return `${name}${extension}`;
}

function lastPathSegment(url: string): string | null {
  try {
    const segment = new URL(url).pathname.split('/').filter((part) => part !== '').pop();
    return segment ? sanitizeFilename(decodeURIComponent(segment)) : null;
  } catch {
    return null;
  }
}

/** Strips path separators and control characters from a suggested file name. */
export function sanitizeFilename(name: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
  return cleaned === '' ? 'response' : cleaned;
}

/** Saves a blob through a temporary link. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url));
}
