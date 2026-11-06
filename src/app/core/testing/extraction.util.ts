import { Extraction } from '../models';
import { lookupJsonPath, valueToText } from './json-path.util';
import { ResponseSnapshot } from './response-snapshot.model';

export interface ExtractionResult {
  readonly id: string;
  readonly variable: string;
  readonly ok: boolean;
  /** The extracted text when ok. */
  readonly value: string;
  /** Why it failed; empty when ok. */
  readonly message: string;
  readonly secret: boolean;
}

/** A variable name that can be written as `{{name}}`. */
export function isValidVariableName(name: string): boolean {
  return /^[^{}\s]+$/.test(name);
}

/** Longest value kept from a response, so a huge body cannot bloat an environment. */
export const MAX_EXTRACTED_CHARS = 20_000;

function extractOne(extraction: Extraction, response: ResponseSnapshot): { ok: true; value: string } | { ok: false; message: string } {
  switch (extraction.source) {
    case 'status':
      return { ok: true, value: String(response.status) };
    case 'header': {
      const value = response.headers.get(extraction.expression.trim().toLowerCase());
      return value === undefined ? { ok: false, message: `The response has no "${extraction.expression}" header.` } : { ok: true, value };
    }
    case 'json': {
      if (response.bodyText === null) return { ok: false, message: 'The response body was not available (too large or not text).' };
      let parsed: unknown;
      try {
        parsed = JSON.parse(response.bodyText);
      } catch {
        return { ok: false, message: 'The response body is not valid JSON.' };
      }
      const found = lookupJsonPath(parsed, extraction.expression);
      return found.found ? { ok: true, value: valueToText(found.value) } : { ok: false, message: `Nothing found at ${extraction.expression}.` };
    }
    case 'regex': {
      if (response.bodyText === null) return { ok: false, message: 'The response body was not available (too large or not text).' };
      let pattern: RegExp;
      try {
        pattern = new RegExp(extraction.expression);
      } catch {
        return { ok: false, message: `"${extraction.expression}" is not a valid regular expression.` };
      }
      const match = pattern.exec(response.bodyText.slice(0, 1_000_000));
      if (!match) return { ok: false, message: 'The pattern did not match the response body.' };
      return { ok: true, value: match[1] ?? match[0] };
    }
  }
}

/** Reads values out of a response for the enabled extractions. Failures are reported, never thrown. */
export function runExtractions(extractions: readonly Extraction[], response: ResponseSnapshot): readonly ExtractionResult[] {
  return extractions
    .filter((extraction) => extraction.enabled)
    .map((extraction): ExtractionResult => {
      const base = { id: extraction.id, variable: extraction.variable.trim(), secret: extraction.secret };
      if (!isValidVariableName(base.variable)) {
        return { ...base, ok: false, value: '', message: 'The variable name is empty or contains spaces or braces.' };
      }
      const outcome = extractOne(extraction, response);
      if (!outcome.ok) return { ...base, ok: false, value: '', message: outcome.message };
      return { ...base, ok: true, value: outcome.value.slice(0, MAX_EXTRACTED_CHARS), message: '' };
    });
}
