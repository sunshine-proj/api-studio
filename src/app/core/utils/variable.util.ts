/** Matches `{{name}}` with optional inner whitespace. */
const VARIABLE_PATTERN = /\{\{\s*([^{}\s][^{}]*?)\s*\}\}/g;

export type VariableMap = ReadonlyMap<string, string>;

export interface ResolveResult {
  readonly text: string;
  /** Names that had no value, in first-seen order and without duplicates. */
  readonly unresolved: readonly string[];
}

/**
 * Replaces `{{name}}` placeholders using a single pass, so substituted values
 * are never re-scanned (no recursive expansion, no loops). Unknown variables
 * are left in the text unchanged and reported in `unresolved`.
 */
export function resolveVariables(text: string, variables: VariableMap): ResolveResult {
  const unresolved: string[] = [];
  const resolved = text.replace(VARIABLE_PATTERN, (match: string, name: string) => {
    const value = variables.get(name);
    if (value === undefined) {
      if (!unresolved.includes(name)) {
        unresolved.push(name);
      }
      return match;
    }
    return value;
  });
  return { text: resolved, unresolved };
}

/** Lists the variable names referenced in a text. */
export function findVariableNames(text: string): readonly string[] {
  const names: string[] = [];
  for (const match of text.matchAll(VARIABLE_PATTERN)) {
    const name = match[1];
    if (name !== undefined && !names.includes(name)) {
      names.push(name);
    }
  }
  return names;
}
