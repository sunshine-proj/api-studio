import { Assertion, AssertionOperator, AssertionTarget } from '../models';
import { resolveVariables, VariableMap } from '../utils/variable.util';
import { lookupJsonPath, valueToText } from './json-path.util';
import { ResponseSnapshot } from './response-snapshot.model';

export interface AssertionResult {
  readonly id: string;
  /** Readable description, e.g. `status equals 200`. */
  readonly label: string;
  readonly passed: boolean;
  /** Why it failed (or the actual value for a pass); empty when there is nothing to add. */
  readonly message: string;
  readonly source: 'assertion' | 'script';
}

/** Longest text a regular expression assertion is run against, limiting the cost of a bad pattern. */
export const MAX_REGEX_INPUT = 1_000_000;

export const OPERATOR_LABELS: Readonly<Record<AssertionOperator, string>> = {
  equals: 'equals',
  'not-equals': 'does not equal',
  contains: 'contains',
  'not-contains': 'does not contain',
  matches: 'matches (regex)',
  exists: 'exists',
  'not-exists': 'does not exist',
  'less-than': 'is less than',
  'greater-than': 'is greater than',
};

export const TARGET_LABELS: Readonly<Record<AssertionTarget, string>> = {
  status: 'Status code',
  header: 'Header',
  json: 'JSON path',
  body: 'Body',
  duration: 'Duration (ms)',
};

/** Operators that need no expected value. */
export function operatorTakesValue(operator: AssertionOperator): boolean {
  return operator !== 'exists' && operator !== 'not-exists';
}

/** Targets that need a property (a header name or JSON path). */
export function targetTakesProperty(target: AssertionTarget): boolean {
  return target === 'header' || target === 'json';
}

type Actual = { readonly present: false; readonly reason?: string } | { readonly present: true; readonly value: unknown };

function readActual(assertion: Assertion, response: ResponseSnapshot): Actual {
  switch (assertion.target) {
    case 'status':
      return { present: true, value: response.status };
    case 'duration':
      return { present: true, value: Math.round(response.durationMs) };
    case 'header': {
      const value = response.headers.get(assertion.property.trim().toLowerCase());
      return value === undefined ? { present: false } : { present: true, value };
    }
    case 'body':
      return response.bodyText === null
        ? { present: false, reason: 'The response body was not available (too large or not text).' }
        : { present: response.bodyText !== '', value: response.bodyText } as Actual;
    case 'json': {
      if (response.bodyText === null) return { present: false, reason: 'The response body was not available (too large or not text).' };
      let parsed: unknown;
      try {
        parsed = JSON.parse(response.bodyText);
      } catch {
        return { present: false, reason: 'The response body is not valid JSON.' };
      }
      const found = lookupJsonPath(parsed, assertion.property);
      return found.found ? { present: true, value: found.value } : { present: false };
    }
  }
}

function describe(assertion: Assertion): string {
  const subject =
    assertion.target === 'header'
      ? `header ${assertion.property}`
      : assertion.target === 'json'
        ? `JSON ${assertion.property}`
        : assertion.target === 'duration'
          ? 'duration (ms)'
          : assertion.target === 'status'
            ? 'status'
            : 'body';
  const verb = OPERATOR_LABELS[assertion.operator];
  return operatorTakesValue(assertion.operator) ? `${subject} ${verb} ${assertion.expected}` : `${subject} ${verb}`;
}

function compare(operator: AssertionOperator, actual: unknown, expected: string): { passed: boolean; message: string } {
  const text = valueToText(actual);
  switch (operator) {
    case 'equals':
    case 'not-equals': {
      const bothNumbers = text.trim() !== '' && expected.trim() !== '' && Number.isFinite(Number(text)) && Number.isFinite(Number(expected));
      const equal = bothNumbers ? Number(text) === Number(expected) : text === expected;
      return { passed: operator === 'equals' ? equal : !equal, message: `Actual: ${shorten(text)}` };
    }
    case 'contains':
      return { passed: text.includes(expected), message: `Actual: ${shorten(text)}` };
    case 'not-contains':
      return { passed: !text.includes(expected), message: `Actual: ${shorten(text)}` };
    case 'matches': {
      let pattern: RegExp;
      try {
        pattern = new RegExp(expected);
      } catch {
        return { passed: false, message: `"${expected}" is not a valid regular expression.` };
      }
      return { passed: pattern.test(text.slice(0, MAX_REGEX_INPUT)), message: `Actual: ${shorten(text)}` };
    }
    case 'less-than':
    case 'greater-than': {
      const left = Number(text);
      const right = Number(expected);
      if (text.trim() === '' || !Number.isFinite(left) || expected.trim() === '' || !Number.isFinite(right)) {
        return { passed: false, message: `Both values must be numbers. Actual: ${shorten(text)}` };
      }
      return { passed: operator === 'less-than' ? left < right : left > right, message: `Actual: ${shorten(text)}` };
    }
    default:
      return { passed: false, message: 'Unsupported operator.' };
  }
}

function shorten(text: string): string {
  const single = text.length > 120 ? `${text.slice(0, 120)}…` : text;
  return single === '' ? '(empty)' : single;
}

/**
 * Runs the enabled assertions against a response. `{{variables}}` in the
 * expected value are resolved, so a response can be compared with a value
 * extracted earlier in a chain.
 */
export function evaluateAssertions(
  assertions: readonly Assertion[],
  response: ResponseSnapshot,
  variables: VariableMap = new Map(),
): readonly AssertionResult[] {
  return assertions
    .filter((assertion) => assertion.enabled)
    .map((assertion): AssertionResult => {
      const expected = resolveVariables(assertion.expected, variables).text;
      const resolved: Assertion = { ...assertion, expected };
      const label = describe(resolved);
      const base = { id: assertion.id, label, source: 'assertion' as const };

      if (targetTakesProperty(assertion.target) && assertion.property.trim() === '') {
        return { ...base, passed: false, message: assertion.target === 'header' ? 'No header name was given.' : 'No JSON path was given.' };
      }
      const actual = readActual(resolved, response);
      if (assertion.operator === 'exists') {
        return { ...base, passed: actual.present, message: actual.present ? '' : (actual.reason ?? 'It does not exist.') };
      }
      if (assertion.operator === 'not-exists') {
        return { ...base, passed: !actual.present, message: actual.present ? 'It exists.' : '' };
      }
      if (!actual.present) {
        return { ...base, passed: false, message: actual.reason ?? 'The value does not exist in the response.' };
      }
      return { ...base, ...compare(assertion.operator, actual.value, expected) };
    });
}
