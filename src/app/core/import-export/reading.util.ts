/**
 * Small readers for untrusted data. Each returns a value of the requested type
 * whatever the input was, so converters never trust the shape of a file.
 */

export type JsonRecord = Readonly<Record<string, unknown>>;

/** Most items read from any one list, so a hostile file cannot create millions of rows. */
export const MAX_LIST_ITEMS = 10_000;

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

export function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function readNumber(value: unknown, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

export function readOneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.find((candidate) => candidate === value) ?? fallback;
}

/** An array's items (capped), or an empty list when the value is not an array. */
export function readList(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value.slice(0, MAX_LIST_ITEMS) : [];
}

export function readRecords(value: unknown): readonly JsonRecord[] {
  return readList(value).filter(isRecord);
}

/** Collects user-facing notes about parts of a file that were skipped or changed. */
export class ImportNotes {
  private static readonly MAX = 50;
  private readonly seen = new Set<string>();
  private overflow = 0;
  readonly messages: string[] = [];

  add(message: string): void {
    if (this.seen.has(message)) return;
    this.seen.add(message);
    if (this.messages.length < ImportNotes.MAX) this.messages.push(message);
    else this.overflow++;
  }

  /** The notes, plus a line counting any that did not fit. */
  toArray(): readonly string[] {
    return this.overflow > 0 ? [...this.messages, `…and ${this.overflow} more.`] : [...this.messages];
  }
}
