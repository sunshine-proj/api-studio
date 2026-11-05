/** Creates a stable unique identifier for a persisted or UI row entity. */
export function newId(): string {
  return crypto.randomUUID();
}
