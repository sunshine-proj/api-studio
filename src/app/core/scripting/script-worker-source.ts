import { ScriptJob } from './script.model';

/**
 * The code that runs inside the sandbox worker: a small API (`request`,
 * `response`, `env`, `test`, `assert`, `console`) around the user's script,
 * which is wrapped in an async function so `await` works and its own variables
 * stay private. It runs only inside the sandbox described in
 * BrowserScriptSandbox, never in the app's own context, and it is plain source
 * text handed to a Worker (the app never evaluates it).
 *
 * Written without backticks or dollar-brace sequences so it can live in a
 * template literal.
 */
const PRELUDE = `
'use strict';
const __input = JSON.parse(__INPUT__);
const __logs = [];
const __tests = [];
const __pending = [];
const __env = new Map(Object.entries(__input.env));
const __cap = (value, max) => { const text = String(value); return text.length > max ? text.slice(0, max) + '…' : text; };
const __format = (values) => values.map((v) => { if (typeof v === 'string') return v; try { return JSON.stringify(v); } catch (e) { return String(v); } }).join(' ');
const __messageOf = (e) => __cap(e && e.message ? e.message : e, 500);
const __logger = (prefix) => (...values) => { if (__logs.length < 100) __logs.push(prefix + __cap(__format(values), 2000)); };
Object.assign(console, { log: __logger(''), info: __logger(''), warn: __logger('warn: '), error: __logger('error: ') });

const request = __input.request;
const response = __input.response === null ? undefined : (() => {
  const r = __input.response;
  return Object.freeze({
    status: r.status, statusText: r.statusText, headers: r.headers, body: r.body, time: r.time,
    json() { if (r.body === null) throw new Error('The response body is not available.'); return JSON.parse(r.body); },
  });
})();
const env = Object.freeze({
  get(name) { return __env.get(String(name)); },
  set(name, value) { __env.set(String(name), String(value)); },
  has(name) { return __env.has(String(name)); },
  all() { return Object.fromEntries(__env); },
});

class AssertionError extends Error { constructor(message) { super(message); this.name = 'AssertionError'; } }
function assert(condition, message) { if (!condition) throw new AssertionError(message || 'Assertion failed'); }
assert.ok = assert;
assert.equal = (actual, expected, message) => {
  if (actual !== expected) throw new AssertionError(message || ('Expected ' + __cap(__format([expected]), 200) + ' but got ' + __cap(__format([actual]), 200)));
};
function test(name, fn) {
  const entry = { name: __cap(name, 200), passed: true, message: '' };
  if (__tests.length < 200) __tests.push(entry);
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      __pending.push(result.then(() => {}, (e) => { entry.passed = false; entry.message = __messageOf(e); }));
    }
  } catch (e) { entry.passed = false; entry.message = __messageOf(e); }
}
function __done(error) {
  Promise.allSettled(__pending).then(() => postMessage({
    type: 'result', error: error, logs: __logs, tests: __tests, env: Object.fromEntries(__env),
    request: __input.phase === 'pre-request' ? request : null,
  }));
}
`;

/** Builds the worker source for a job. The data travels as one JSON string literal, so it cannot become code. */
export function buildWorkerSource(job: ScriptJob): string {
  const input = JSON.stringify({
    phase: job.phase,
    request: job.request,
    response: job.response,
    env: job.env,
  });
  return (
    PRELUDE.replace('__INPUT__', () => JSON.stringify(input)) +
    '\n(async function () {\n\'use strict\';\n' +
    job.source +
    '\n})().then(() => __done(null), (e) => __done(__messageOf(e)));\n'
  );
}
