import { buildWorkerSource } from './script-worker-source';
import { ScriptJob } from './script.model';

const job = (over: Partial<ScriptJob> = {}): ScriptJob => ({
  phase: 'pre-request',
  source: 'env.set("a", "1");',
  request: { method: 'GET', url: 'https://a.test', headers: {}, body: null },
  response: null,
  env: { x: '1' },
  ...over,
});

/** Runs the generated source in a fake worker scope, so the API can be tested without a browser. */
async function runInFakeWorker(source: string): Promise<Record<string, unknown>> {
  const posted: Record<string, unknown>[] = [];
  // Test-only: executes OUR generated worker source, standing in for the browser's Worker (jsdom has none).
  // The app itself never evaluates script text; it only hands it to a Worker inside the sandbox.
  new Function('postMessage', 'console', source)((m: Record<string, unknown>) => posted.push(m), {});
  await new Promise((resolve) => setTimeout(resolve, 20));
  return posted[0];
}

describe('worker source', () => {
  it('carries the job data as a single JSON string, so it can never become code', () => {
    const source = buildWorkerSource(job({ env: { evil: '"; postMessage("pwned"); //' } }));
    expect(source).toContain('JSON.parse("');
    expect(source).not.toMatch(/^postMessage\("pwned"\)/m);
  });

  it('does not contain template-literal pitfalls and ends the wrapper after the user code, even for trailing comments', () => {
    const source = buildWorkerSource(job({ source: 'env.set("a","1") // trailing comment' }));
    expect(source).toContain('// trailing comment\n})()');
  });

  it('exposes request, response, env, test and assert to the script, and reports the result', async () => {
    const result = await runInFakeWorker(
      buildWorkerSource(
        job({
          phase: 'test',
          source: `
            env.set('seen', String(response.status) + request.method);
            test('status is 200', () => assert.equal(response.status, 200));
            test('body has id', () => assert(response.json().id === 7, 'no id'));
            test('fails', () => { throw new Error('boom'); });
            console.log('hello', { a: 1 });`,
          response: { status: 200, statusText: 'OK', headers: { 'x-a': '1' }, body: '{"id":7}', time: 12 },
        }),
      ),
    );
    expect(result).toMatchObject({
      type: 'result',
      error: null,
      logs: ['hello {"a":1}'],
      env: { x: '1', seen: '200GET' },
      request: null,
    });
    expect(result['tests']).toEqual([
      { name: 'status is 200', passed: true, message: '' },
      { name: 'body has id', passed: true, message: '' },
      { name: 'fails', passed: false, message: 'boom' },
    ]);
  });

  it('lets a pre-request script change the request and returns it', async () => {
    const result = await runInFakeWorker(
      buildWorkerSource(job({ source: `request.url += '?x=1'; request.headers['X-Token'] = env.get('x'); request.method = 'POST';` })),
    );
    expect(result['request']).toEqual({ method: 'POST', url: 'https://a.test?x=1', headers: { 'X-Token': '1' }, body: null });
  });

  it('reports a thrown error and still returns what was collected', async () => {
    const result = await runInFakeWorker(buildWorkerSource(job({ source: `console.log('before'); throw new Error('bad script');` })));
    expect(result).toMatchObject({ error: 'bad script', logs: ['before'] });
  });

  it('supports await, and waits for async tests', async () => {
    const result = await runInFakeWorker(
      buildWorkerSource(job({ phase: 'test', source: `await new Promise((r) => setTimeout(r, 5)); test('async', async () => { await null; assert(false, 'late failure'); });` })),
    );
    expect(result['tests']).toEqual([{ name: 'async', passed: false, message: 'late failure' }]);
  });

  it('keeps the script\'s own variables out of the harness', async () => {
    const result = await runInFakeWorker(buildWorkerSource(job({ source: `const __logs = 'mine'; const request2 = 1; env.set('ok', 'yes');` })));
    expect(result).toMatchObject({ error: null, env: { ok: 'yes' } });
  });

  it('caps logs', async () => {
    const result = await runInFakeWorker(buildWorkerSource(job({ source: `for (let i = 0; i < 500; i++) console.log('line ' + i);` })));
    expect((result['logs'] as string[]).length).toBe(100);
  });
});
