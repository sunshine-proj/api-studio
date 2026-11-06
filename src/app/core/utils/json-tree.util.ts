export type JsonKind = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';

export function jsonKind(value: unknown): JsonKind {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  switch (typeof value) {
    case 'string':
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    default:
      return 'object';
  }
}

export function isJsonContainer(value: unknown): boolean {
  const kind = jsonKind(value);
  return kind === 'object' || kind === 'array';
}

/** Child entries of an object or array, in document order. Scalars have none. */
export function jsonChildren(value: unknown): readonly (readonly [string, unknown])[] {
  const kind = jsonKind(value);
  if (kind === 'array') return (value as readonly unknown[]).map((item, index) => [String(index), item] as const);
  if (kind === 'object') return Object.entries(value as Record<string, unknown>);
  return [];
}

/** Short description of a container, e.g. `{3 keys}` or `[2 items]`. */
export function jsonSummary(value: unknown): string {
  const count = jsonChildren(value).length;
  if (jsonKind(value) === 'array') return `[${count} ${count === 1 ? 'item' : 'items'}]`;
  return `{${count} ${count === 1 ? 'key' : 'keys'}}`;
}

/** Longest string shown in full in the tree; longer ones are cut with an ellipsis. */
export const MAX_TREE_STRING = 1000;

/** Display text of a scalar: strings are quoted like JSON and long ones are shortened. */
export function jsonScalarText(value: unknown): string {
  if (typeof value === 'string') {
    const text = value.length > MAX_TREE_STRING ? `${value.slice(0, MAX_TREE_STRING)}…` : value;
    return JSON.stringify(text);
  }
  return String(value);
}

/** Parses JSON text. Returns `{ ok: false }` instead of throwing, since the body may not be valid JSON. */
export function parseJson(text: string): { readonly ok: true; readonly value: unknown } | { readonly ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}
