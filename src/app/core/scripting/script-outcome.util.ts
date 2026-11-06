import { isRecord } from '../import-export/reading.util';
import { ScriptOutcome, ScriptRequestView, ScriptTestResult } from './script.model';

const MAX_ENV_ENTRIES = 1000;
const MAX_NAME = 200;
const MAX_VALUE = 20_000;
const MAX_BODY = 5_000_000;

function readStringMap(value: unknown, maxEntries: number, maxValue: number): Record<string, string> | null {
  if (!isRecord(value)) return null;
  const result: Record<string, string> = Object.create(null) as Record<string, string>;
  let count = 0;
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== 'string' || key.length > MAX_NAME || key === '' || count >= maxEntries) continue;
    result[key] = entry.slice(0, maxValue);
    count++;
  }
  return result;
}

/** Reads the request a script left behind. Returns null unless it still has the expected shape. */
export function readScriptRequest(value: unknown): ScriptRequestView | null {
  if (!isRecord(value) || typeof value['method'] !== 'string' || typeof value['url'] !== 'string') return null;
  const headers = readStringMap(value['headers'], MAX_ENV_ENTRIES, MAX_VALUE) ?? {};
  const body = typeof value['body'] === 'string' ? value['body'].slice(0, MAX_BODY) : null;
  return { method: value['method'].slice(0, 100), url: value['url'].slice(0, 100_000), headers: { ...headers }, body };
}

/**
 * Turns the message a sandbox worker posted into a `ScriptOutcome`. The message
 * is untrusted (the script can post anything), so every field is type-checked
 * and size-limited, and anything unexpected is dropped.
 */
export function readScriptOutcome(message: unknown, fallbackEnv: Readonly<Record<string, string>>): ScriptOutcome {
  const failed = (error: string): ScriptOutcome => ({ ok: false, error, timedOut: false, logs: [], tests: [], env: fallbackEnv, request: null });
  if (!isRecord(message) || message['type'] !== 'result') return failed('The script returned an unexpected result.');

  const logs = (Array.isArray(message['logs']) ? message['logs'] : [])
    .filter((line): line is string => typeof line === 'string')
    .slice(0, 100)
    .map((line) => line.slice(0, 2000));
  const tests: ScriptTestResult[] = (Array.isArray(message['tests']) ? message['tests'] : [])
    .slice(0, 200)
    .filter(isRecord)
    .map((entry) => ({
      name: typeof entry['name'] === 'string' ? entry['name'].slice(0, MAX_NAME) : 'test',
      passed: entry['passed'] === true,
      message: typeof entry['message'] === 'string' ? entry['message'].slice(0, 500) : '',
    }));
  const error = typeof message['error'] === 'string' ? message['error'].slice(0, 500) : null;
  return {
    ok: error === null,
    error,
    timedOut: false,
    logs,
    tests,
    env: readStringMap(message['env'], MAX_ENV_ENTRIES, MAX_VALUE) ?? fallbackEnv,
    request: readScriptRequest(message['request']),
  };
}
