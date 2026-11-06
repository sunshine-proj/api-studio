export type PathSegment = string | number;

export type PathLookup = { readonly found: true; readonly value: unknown } | { readonly found: false };

/**
 * Parses a small JSON path: an optional leading `$`, then `.name`, `[0]`,
 * `[-1]` (from the end) and `['quoted name']`. Wildcards and filters are not
 * supported. Returns null when the path is malformed.
 */
export function parseJsonPath(path: string): readonly PathSegment[] | null {
  const text = path.trim();
  const segments: PathSegment[] = [];
  let i = text.startsWith('$') ? 1 : 0;
  if (text === '' ) return null;

  while (i < text.length) {
    const char = text[i];
    if (char === '.') {
      const match = /^[^.[\]\s'"]+/.exec(text.slice(i + 1));
      if (!match) return null;
      segments.push(match[0]);
      i += 1 + match[0].length;
    } else if (char === '[') {
      const end = text.indexOf(']', i);
      if (end === -1) return null;
      const inner = text.slice(i + 1, end);
      const quoted = /^(['"])(.*)\1$/.exec(inner);
      if (quoted) segments.push(quoted[2]);
      else if (/^-?\d+$/.test(inner)) segments.push(Number(inner));
      else return null;
      i = end + 1;
    } else if (i === (text.startsWith('$') ? 1 : 0)) {
      // A path may start with a bare name: `data.items[0]`.
      const match = /^[^.[\]\s'"]+/.exec(text.slice(i));
      if (!match) return null;
      segments.push(match[0]);
      i += match[0].length;
    } else {
      return null;
    }
  }
  return segments;
}

/** Follows a path through parsed JSON. Only a value's own properties are read, never inherited ones such as `constructor`. */
export function lookupJsonPath(root: unknown, path: string): PathLookup {
  const segments = parseJsonPath(path);
  if (segments === null) return { found: false };
  let current: unknown = root;
  for (const segment of segments) {
    if (Array.isArray(current)) {
      if (typeof segment !== 'number') return { found: false };
      const index = segment < 0 ? current.length + segment : segment;
      if (index < 0 || index >= current.length) return { found: false };
      current = current[index];
    } else if (typeof current === 'object' && current !== null) {
      const key = String(segment);
      if (!Object.prototype.hasOwnProperty.call(current, key)) return { found: false };
      current = (current as Record<string, unknown>)[key];
    } else {
      return { found: false };
    }
  }
  return { found: true, value: current };
}

/** Text form of a JSON value, as shown to users and compared by assertions. */
export function valueToText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined) return '';
  return typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value);
}
