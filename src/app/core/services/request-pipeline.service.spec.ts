import { TestBed } from '@angular/core/testing';
import { ApiStudioDatabase, DATABASE_NAME } from '../database/database.service';
import { ExecutionResult, ExecutionSuccess, RequestDefinition } from '../models';
import { OAuthPopup } from '../oauth/oauth-popup';
import { OAuthTokenStore } from '../oauth/oauth-token-store.service';
import { ScriptSandbox } from '../scripting/script-sandbox';
import { ScriptJob, ScriptOutcome } from '../scripting/script.model';
import { createEmptyRequest } from '../utils/request-factory';
import { EnvironmentStore } from './environment-store.service';
import { RequestPipeline } from './request-pipeline.service';
import { ExecutionContext, RequestExecutionService } from './request-execution.service';
import { SettingsStore } from './settings-store.service';

let counter = 0;

class FakeExecutor extends RequestExecutionService {
  sent: { definition: RequestDefinition; context: ExecutionContext }[] = [];
  next: ExecutionResult = ok(200, '{"id":7,"token":"tok"}', { 'content-type': 'application/json', 'x-request': 'r1' });
  execute(definition: RequestDefinition, context: ExecutionContext): Promise<ExecutionResult> {
    this.sent.push({ definition, context });
    return Promise.resolve(this.next);
  }
}

class FakeSandbox extends ScriptSandbox {
  jobs: ScriptJob[] = [];
  respond: (job: ScriptJob) => Partial<ScriptOutcome> = () => ({});
  run(job: ScriptJob): Promise<ScriptOutcome> {
    this.jobs.push(job);
    return Promise.resolve({ ok: true, error: null, timedOut: false, logs: [], tests: [], env: job.env, request: job.phase === 'pre-request' ? job.request : null, ...this.respond(job) });
  }
}

function ok(status: number, body: string, headers: Record<string, string>): ExecutionSuccess {
  return {
    ok: true,
    response: {
      status, statusText: 'OK', headers: Object.entries(headers).map(([name, value]) => ({ name, value })),
      body: { contentType: headers['content-type'] ?? null, size: body.length, truncated: false },
      durationMs: 12, url: 'https://a.test/', redirected: false, cookies: { available: false, reason: '' },
    },
    body: new Blob([body]),
    request: { method: 'GET', url: 'https://a.test/', headers: [], body: { type: 'none' }, options: createEmptyRequest().options },
    warnings: [],
  };
}

describe('RequestPipeline', () => {
  let dbName: string;
  let executor: FakeExecutor;
  let sandbox: FakeSandbox;
  let pipeline: RequestPipeline;
  let environments: EnvironmentStore;

  const def = (over: Partial<RequestDefinition> = {}): RequestDefinition => ({ ...createEmptyRequest(), url: 'https://a.test/x', ...over });
  const ctx = (variables: Record<string, string> = {}): ExecutionContext => ({ variables: new Map(Object.entries(variables)) });
  const withActiveEnvironment = async (): Promise<void> => {
    const env = (await environments.create('Dev'))!;
    await environments.setActive(env.id);
  };

  beforeEach(async () => {
    dbName = `pipeline-db-${++counter}`;
    executor = new FakeExecutor();
    sandbox = new FakeSandbox();
    TestBed.configureTestingModule({
      providers: [
        { provide: DATABASE_NAME, useValue: dbName },
        { provide: RequestExecutionService, useValue: executor },
        { provide: ScriptSandbox, useValue: sandbox },
        { provide: OAuthPopup, useValue: { open: () => Promise.reject(new Error('not used')) } },
      ],
    });
    pipeline = TestBed.inject(RequestPipeline);
    environments = TestBed.inject(EnvironmentStore);
    await Promise.all([environments.ready, TestBed.inject(SettingsStore).ready]);
  });

  afterEach(async () => {
    TestBed.resetTestingModule();
    await new ApiStudioDatabase(dbName).delete();
  });

  it('just sends a plain request, with nothing to report', async () => {
    const out = await pipeline.run(def(), ctx());
    expect(out.result.ok).toBe(true);
    expect(out.report).toEqual({ checks: [], extractions: [], logs: [], notes: [] });
    expect(out.variableUpdates.size).toBe(0);
    expect(sandbox.jobs).toEqual([]);
  });

  it('evaluates assertions against the response', async () => {
    const out = await pipeline.run(
      def({
        assertions: [
          { id: '1', enabled: true, target: 'status', property: '', operator: 'equals', expected: '200' },
          { id: '2', enabled: true, target: 'json', property: '$.id', operator: 'equals', expected: '8' },
          { id: '3', enabled: true, target: 'header', property: 'X-Request', operator: 'exists', expected: '' },
        ],
      }),
      ctx(),
    );
    expect(out.report.checks.map((c) => [c.label, c.passed])).toEqual([
      ['status equals 200', true], ['JSON $.id equals 8', false], ['header X-Request exists', true],
    ]);
  });

  it('chains: extracts values into the active environment, where the next request can use them', async () => {
    await withActiveEnvironment();
    const first = await pipeline.run(
      def({ extractions: [
        { id: 'e1', enabled: true, variable: 'userId', source: 'json', expression: '$.id', secret: false },
        { id: 'e2', enabled: true, variable: 'authToken', source: 'json', expression: '$.token', secret: true },
      ] }),
      ctx(),
    );
    expect(first.report.extractions.map((e) => [e.variable, e.ok, e.value])).toEqual([['userId', true, '7'], ['authToken', true, 'tok']]);
    expect(first.variableUpdates.get('userId')).toBe('7');
    expect(environments.variables().get('userId')).toBe('7');
    expect(environments.active()?.variables.find((v) => v.name === 'authToken')?.secret).toBe(true);

    // The next request resolves {{userId}} from the environment.
    await pipeline.run(def({ url: 'https://a.test/users/{{userId}}' }), { variables: environments.variables() });
    expect(executor.sent.at(-1)!.context.variables.get('userId')).toBe('7');
  });

  it('lets assertions use a value extracted in the same request', async () => {
    const out = await pipeline.run(
      def({
        extractions: [{ id: 'e', enabled: true, variable: 'wanted', source: 'json', expression: '$.id', secret: false }],
        assertions: [{ id: 'a', enabled: true, target: 'json', property: '$.id', operator: 'equals', expected: '{{wanted}}' }],
      }),
      ctx(),
    );
    expect(out.report.checks[0].passed).toBe(true);
  });

  it('says when extracted values could not be stored because no environment is active', async () => {
    const out = await pipeline.run(def({ extractions: [{ id: 'e', enabled: true, variable: 'userId', source: 'status', expression: '', secret: false }] }), ctx());
    expect(out.report.notes.join(' ')).toMatch(/No environment is selected.*\{\{userId\}\}/);
    expect(out.variableUpdates.get('userId')).toBe('200'); // still available to a runner
  });

  it('does not store variables for failed extractions', async () => {
    await withActiveEnvironment();
    const out = await pipeline.run(def({ extractions: [{ id: 'e', enabled: true, variable: 'nope', source: 'json', expression: '$.missing', secret: false }] }), ctx());
    expect(out.report.extractions[0]).toMatchObject({ ok: false, message: 'Nothing found at $.missing.' });
    expect(environments.variables().has('nope')).toBe(false);
  });

  describe('scripts', () => {
    const scripts = (over: Partial<NonNullable<RequestDefinition['scripts']>> = {}) => ({ enabled: true, preRequest: '', test: '', ...over });

    it('never runs scripts that are switched off', async () => {
      await pipeline.run(def({ scripts: scripts({ enabled: false, preRequest: 'x', test: 'y' }) }), ctx());
      expect(sandbox.jobs).toEqual([]);
    });

    it('applies what a pre-request script changes, and variables it sets', async () => {
      sandbox.respond = (job) => ({ request: { ...job.request, url: 'https://a.test/changed', headers: { 'X-Sig': 'abc' } }, env: { ...job.env, signed: 'yes' } });
      const out = await pipeline.run(def({ scripts: scripts({ preRequest: 'x' }) }), ctx({ keep: '1' }));
      const sent = executor.sent[0];
      expect(sent.definition.url).toBe('https://a.test/changed');
      expect(sent.definition.headers.map((h) => h.key)).toEqual(['X-Sig']);
      expect(sent.context.variables.get('signed')).toBe('yes');
      expect(sent.context.variables.get('keep')).toBe('1');
      expect(out.report.notes).toContain('The pre-request script changed the request before it was sent.');
      expect(out.variableUpdates.get('signed')).toBe('yes');
      expect(sandbox.jobs[0]).toMatchObject({ phase: 'pre-request', response: null });
    });

    it('does not send anything when the pre-request script fails', async () => {
      sandbox.respond = () => ({ ok: false, error: 'boom', logs: ['before'] });
      const out = await pipeline.run(def({ scripts: scripts({ preRequest: 'x' }) }), ctx());
      expect(executor.sent).toEqual([]);
      expect(out.result).toMatchObject({ ok: false, error: { kind: 'invalid-request', message: 'The pre-request script failed: boom' } });
      expect(out.report.logs).toEqual(['[pre-request] before']);
    });

    it('gives the test script the response and merges its tests into the checks', async () => {
      sandbox.respond = () => ({ tests: [{ name: 'has id', passed: true, message: '' }, { name: 'is fast', passed: false, message: 'too slow' }], logs: ['hi'] });
      const out = await pipeline.run(
        def({ scripts: scripts({ test: 'x' }), assertions: [{ id: 'a', enabled: true, target: 'status', property: '', operator: 'equals', expected: '200' }] }),
        ctx(),
      );
      const job = sandbox.jobs[0];
      expect(job).toMatchObject({ phase: 'test', response: { status: 200, body: '{"id":7,"token":"tok"}', headers: { 'x-request': 'r1' } } });
      expect(out.report.checks.map((c) => [c.label, c.passed, c.source])).toEqual([
        ['status equals 200', true, 'assertion'], ['has id', true, 'script'], ['is fast', false, 'script'],
      ]);
      expect(out.report.logs).toEqual(['[test] hi']);
    });

    it('records a failing test script as a failed check, without losing the response', async () => {
      sandbox.respond = () => ({ ok: false, error: 'ReferenceError: nope' });
      const out = await pipeline.run(def({ scripts: scripts({ test: 'x' }) }), ctx());
      expect(out.result.ok).toBe(true);
      expect(out.report.checks).toEqual([{ id: 'script:error', label: 'Test script', passed: false, message: 'ReferenceError: nope', source: 'script' }]);
    });

    it('stores variables set by the test script', async () => {
      await withActiveEnvironment();
      sandbox.respond = (job) => ({ env: { ...job.env, fromScript: 'v' } });
      await pipeline.run(def({ scripts: scripts({ test: 'x' }) }), ctx());
      expect(environments.variables().get('fromScript')).toBe('v');
    });

    it('does not run the test script when the request failed', async () => {
      executor.next = { ok: false, error: { kind: 'network', message: 'down' }, request: null, durationMs: 1, warnings: [] };
      await pipeline.run(def({ scripts: scripts({ test: 'x' }), assertions: [{ id: 'a', enabled: true, target: 'status', property: '', operator: 'equals', expected: '200' }] }), ctx());
      expect(sandbox.jobs).toEqual([]);
    });
  });

  describe('OAuth 2.0', () => {
    const oauth = { type: 'oauth2' as const, authorizationUrl: 'https://id.test/a', tokenUrl: 'https://id.test/t', clientId: 'app', scope: 'read' };

    it('does not send when there is no token, and says what to do', async () => {
      const out = await pipeline.run(def({ auth: oauth }), ctx());
      expect(executor.sent).toEqual([]);
      expect(out.result).toMatchObject({ ok: false, error: { kind: 'invalid-request', message: expect.stringContaining('Get new token') } });
    });

    it('sends the stored access token as a Bearer token', async () => {
      TestBed.inject(OAuthTokenStore).set(['https://id.test/t', 'app', 'read'].join('\n'), { accessToken: 'at-1', tokenType: 'Bearer', expiresAt: null, refreshToken: null, scope: null });
      await pipeline.run(def({ auth: oauth }), ctx());
      expect(executor.sent[0].definition.auth).toEqual({ type: 'bearer', token: 'at-1' });
    });
  });
});
