/** Largest import file accepted. Imported files are untrusted, so this is checked before parsing. */
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

/** Deepest nesting accepted, so a hostile file cannot exhaust the stack of later recursive code. */
export const MAX_JSON_DEPTH = 64;

/** Keys that can change an object's prototype chain when copied carelessly. */
const FORBIDDEN_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

/** Thrown for any reason an import file is refused. The message is safe to show to the user. */
export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportError';
  }
}

/**
 * Parses untrusted JSON text. It refuses oversized text, invalid JSON, nesting
 * deeper than `MAX_JSON_DEPTH`, and any object key named `__proto__`,
 * `constructor` or `prototype` (prototype pollution), wherever it appears.
 */
export function parseUntrustedJson(text: string, maxBytes = MAX_IMPORT_BYTES): unknown {
  // A cheap bound checked before any parsing. Callers should also reject oversized files by `File.size` before reading them.
  if (text.length > maxBytes) {
    throw new ImportError(`The file is larger than the ${Math.round(maxBytes / (1024 * 1024))} MB import limit.`);
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ImportError('The file is not valid JSON. YAML and other formats are not supported.');
  }
  assertSafe(value);
  return value;
}

/** Walks the value iteratively (no recursion on hostile depth) and throws on forbidden keys or excess depth. */
function assertSafe(root: unknown): void {
  const stack: { readonly value: unknown; readonly depth: number }[] = [{ value: root, depth: 0 }];
  while (stack.length > 0) {
    const { value, depth } = stack.pop()!;
    if (typeof value !== 'object' || value === null) continue;
    if (depth > MAX_JSON_DEPTH) {
      throw new ImportError(`The file is nested more than ${MAX_JSON_DEPTH} levels deep.`);
    }
    if (Array.isArray(value)) {
      for (const item of value) stack.push({ value: item, depth: depth + 1 });
      continue;
    }
    for (const key of Object.keys(value)) {
      if (FORBIDDEN_KEYS.has(key)) {
        throw new ImportError(`The file contains the forbidden key "${key}" and was rejected.`);
      }
      stack.push({ value: (value as Record<string, unknown>)[key], depth: depth + 1 });
    }
  }
}
