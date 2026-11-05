/** Turns a storage failure into a message a user can act on. */
export function describeStorageError(error: unknown, action: 'load' | 'save'): string {
  const name = error instanceof Error ? error.name : '';
  if (name === 'QuotaExceededError') {
    return 'Browser storage is full, so the change was not saved. Export your data and free some space.';
  }
  return action === 'load'
    ? 'Your saved data could not be loaded. Browser storage may be unavailable (for example in a private window).'
    : 'The change could not be saved to browser storage and was not applied.';
}
