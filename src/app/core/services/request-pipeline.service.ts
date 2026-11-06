import { Injectable, inject } from '@angular/core';
import { OAuthService } from '../oauth/oauth.service';
import { ExecutionFailure, ExecutionResult, ExecutionSuccess, RequestDefinition } from '../models';
import { AssertionResult, evaluateAssertions } from '../testing/assertions.util';
import { ExtractionResult, runExtractions } from '../testing/extraction.util';
import { ResponseSnapshot } from '../testing/response-snapshot.model';
import { ScriptSandbox } from '../scripting/script-sandbox';
import { applyScriptRequest, toScriptRequest } from '../scripting/script-request.util';
import { ScriptOutcome } from '../scripting/script.model';
import { decodeBody, detectBodyKind } from '../utils/response.util';
import { EnvironmentStore } from './environment-store.service';
import { ExecutionContext, RequestExecutionService } from './request-execution.service';

/** Largest body decoded for assertions, extractions and scripts. */
export const MAX_SNAPSHOT_BYTES = 10 * 1024 * 1024;

/** Everything learned from running the checks around a request. */
export interface PipelineReport {
  /** Assertion results, followed by the results of tests written in a script. */
  readonly checks: readonly AssertionResult[];
  readonly extractions: readonly ExtractionResult[];
  /** Output of `console.log` in scripts. */
  readonly logs: readonly string[];
  /** Things the user should know, e.g. that a script changed the request. */
  readonly notes: readonly string[];
}

export interface PipelineOutput {
  readonly result: ExecutionResult;
  readonly report: PipelineReport;
  /** Variables set by extractions and scripts, for callers that keep their own variable set (the runner). */
  readonly variableUpdates: ReadonlyMap<string, string>;
}

const EMPTY_REPORT: PipelineReport = { checks: [], extractions: [], logs: [], notes: [] };

/**
 * Sends a request together with everything around it, in this order:
 *
 *  1. the pre-request script (if enabled), which may change the request and variables;
 *  2. OAuth 2.0: the stored access token becomes a Bearer header;
 *  3. the request itself, through `RequestExecutionService`;
 *  4. extractions, which copy response values into environment variables (chaining);
 *  5. assertions;
 *  6. the test script (if enabled).
 *
 * Tabs and the collection runner both go through here.
 */
@Injectable({ providedIn: 'root' })
export class RequestPipeline {
  private readonly executor = inject(RequestExecutionService);
  private readonly sandbox = inject(ScriptSandbox);
  private readonly oauth = inject(OAuthService);
  private readonly environments = inject(EnvironmentStore);

  async run(definition: RequestDefinition, context: ExecutionContext): Promise<PipelineOutput> {
    const notes: string[] = [];
    const logs: string[] = [];
    const variables = new Map(context.variables);
    const updates = new Map<string, string>();
    const secretNames = new Set<string>();
    const scripts = definition.scripts?.enabled ? definition.scripts : undefined;
    let current = definition;

    const stop = (message: string, checks: readonly AssertionResult[] = []): PipelineOutput => ({
      result: this.invalid(message),
      report: { checks, extractions: [], logs, notes },
      variableUpdates: updates,
    });
    const absorb = (outcome: ScriptOutcome): void => {
      for (const [name, value] of Object.entries(outcome.env)) {
        if (variables.get(name) !== value) {
          variables.set(name, value);
          updates.set(name, value);
        }
      }
    };

    // 1. Pre-request script.
    if (scripts && scripts.preRequest.trim() !== '') {
      const outcome = await this.sandbox.run({
        phase: 'pre-request',
        source: scripts.preRequest,
        request: toScriptRequest(current),
        response: null,
        env: Object.fromEntries(variables),
      });
      logs.push(...outcome.logs.map((line) => `[pre-request] ${line}`));
      if (!outcome.ok) return stop(`The pre-request script failed: ${outcome.error ?? 'unknown error'}`);
      if (outcome.request) {
        const changed = applyScriptRequest(current, outcome.request);
        if (JSON.stringify(changed) !== JSON.stringify(current)) notes.push('The pre-request script changed the request before it was sent.');
        current = changed;
      }
      absorb(outcome);
    }

    // 2. OAuth 2.0 access token.
    if (current.auth.type === 'oauth2') {
      const token = await this.oauth.ensureToken(current.auth, variables);
      if (!token.ok) return stop(token.message);
      current = { ...current, auth: { type: 'bearer', token: token.accessToken } };
    }

    // 3. The request.
    const result = await this.executor.execute(current, { ...context, variables });
    if (!result.ok) {
      return { result, report: { ...EMPTY_REPORT, logs, notes }, variableUpdates: updates };
    }

    // 4–6. Checks on the response.
    const snapshot = await this.snapshot(result);
    const extractions = runExtractions(definition.extractions ?? [], snapshot);
    for (const extraction of extractions) {
      if (!extraction.ok) continue;
      variables.set(extraction.variable, extraction.value);
      updates.set(extraction.variable, extraction.value);
      if (extraction.secret) secretNames.add(extraction.variable);
    }
    const checks: AssertionResult[] = [...evaluateAssertions(definition.assertions ?? [], snapshot, variables)];

    if (scripts && scripts.test.trim() !== '') {
      const outcome = await this.sandbox.run({
        phase: 'test',
        source: scripts.test,
        request: toScriptRequest(current),
        response: {
          status: snapshot.status,
          statusText: snapshot.statusText,
          headers: Object.fromEntries(snapshot.headers),
          body: snapshot.bodyText,
          time: snapshot.durationMs,
        },
        env: Object.fromEntries(variables),
      });
      logs.push(...outcome.logs.map((line) => `[test] ${line}`));
      checks.push(...outcome.tests.map((t): AssertionResult => ({ id: `script:${t.name}`, label: t.name, passed: t.passed, message: t.message, source: 'script' })));
      if (!outcome.ok) {
        checks.push({ id: 'script:error', label: 'Test script', passed: false, message: outcome.error ?? 'The script failed.', source: 'script' });
      }
      absorb(outcome);
    }

    // Store what was learned so later requests can use it.
    const unsaved: string[] = [];
    for (const [name, value] of updates) {
      if (!this.environments.upsertVariable(name, value, secretNames.has(name))) unsaved.push(name);
    }
    if (unsaved.length > 0) {
      notes.push(`No environment is selected, so ${unsaved.map((n) => `{{${n}}}`).join(', ')} could not be saved for later requests. Select or create an environment to keep extracted values.`);
    }

    return { result, report: { checks, extractions, logs, notes }, variableUpdates: updates };
  }

  private invalid(message: string): ExecutionFailure {
    return { ok: false, error: { kind: 'invalid-request', message }, request: null, durationMs: null, warnings: [] };
  }

  private async snapshot(result: ExecutionSuccess): Promise<ResponseSnapshot> {
    const { response, body } = result;
    const textual = ['json', 'xml', 'html', 'text'].includes(detectBodyKind(response.body.contentType));
    const bodyText = textual && body.size <= MAX_SNAPSHOT_BYTES ? await decodeBody(body, response.body.contentType) : null;
    const headers = new Map<string, string>();
    for (const header of response.headers) {
      const name = header.name.toLowerCase();
      headers.set(name, headers.has(name) ? `${headers.get(name)}, ${header.value}` : header.value);
    }
    return { status: response.status, statusText: response.statusText, headers, bodyText, durationMs: response.durationMs };
  }
}
