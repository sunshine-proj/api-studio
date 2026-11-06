import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';
import { readScriptOutcome } from './script-outcome.util';
import { buildWorkerSource } from './script-worker-source';
import { DEFAULT_SCRIPT_TIMEOUT_MS, ScriptJob, ScriptOutcome } from './script.model';

/**
 * Runs user scripts in isolation. Replaceable in tests. Implementations must
 * never run a script with access to the page, the network or storage.
 */
@Injectable({ providedIn: 'root', useFactory: () => inject(BrowserScriptSandbox) })
export abstract class ScriptSandbox {
  abstract run(job: ScriptJob): Promise<ScriptOutcome>;
}

/** File name of the page script that runs inside the sandbox frame (served from `public/`). */
const BOOTSTRAP_FILE = 'script-sandbox-bootstrap.js';

/**
 * What the sandbox's own page is allowed to do. Everything not listed is
 * forbidden, in particular every kind of network request (`connect-src`).
 * Its only script is the bootstrap file, so there are no inline scripts.
 */
function sandboxPolicy(bootstrapUrl: string): string {
  return `default-src 'none'; script-src ${bootstrapUrl}; worker-src blob:; connect-src 'none'`;
}

type Reply = { readonly kind: 'ready' } | { readonly kind: 'message'; readonly data: unknown } | { readonly kind: 'failed'; readonly message: string };

type SandboxHealth = { readonly safe: true } | { readonly safe: false; readonly reason: string };

/**
 * Runs scripts like this:
 *
 *   app page
 *     └─ iframe  sandbox="allow-scripts"   (no allow-same-origin: it gets an opaque
 *        │                                  origin, so it cannot touch the app's
 *        │                                  storage, DOM or cookies)
 *        │        + a CSP that forbids all network access and inline scripts
 *        └─ Worker (from a blob)           the user's script. A worker has no DOM
 *                                          and cannot navigate or open windows, and it
 *                                          inherits the iframe's CSP, so it cannot
 *                                          send anything anywhere.
 *
 * The script's text is only ever given to a Worker as source, never evaluated
 * by the app (no eval, no Function). Timeouts remove the iframe, which stops
 * the worker. Before the first script runs, a canary check proves the policy
 * really is enforced in this browser; if it cannot be proven, scripts are
 * refused rather than run unprotected.
 *
 * Checked in Chromium. A browser that does not support workers inside a
 * sandboxed iframe, or does not apply the policy to them, will refuse scripts.
 */
@Injectable({ providedIn: 'root' })
export class BrowserScriptSandbox extends ScriptSandbox {
  private readonly document = inject(DOCUMENT);
  private health: Promise<SandboxHealth> | null = null;

  async run(job: ScriptJob): Promise<ScriptOutcome> {
    const health = await this.checkHealth();
    if (!health.safe) return this.failure(job, health.reason);

    const timeoutMs = job.timeoutMs ?? DEFAULT_SCRIPT_TIMEOUT_MS;
    const reply = await this.exchange({ code: buildWorkerSource(job) }, timeoutMs);
    if (reply === 'timeout') {
      return { ...this.failure(job, `The script took longer than ${timeoutMs / 1000} seconds and was stopped.`), timedOut: true };
    }
    if (reply.kind === 'failed') return this.failure(job, `The script could not run: ${reply.message}`);
    if (reply.kind === 'message') return readScriptOutcome(reply.data, job.env);
    return this.failure(job, 'The script returned an unexpected result.');
  }

  /** Proves, once, that the sandbox blocks network access from inside the worker. */
  private checkHealth(): Promise<SandboxHealth> {
    this.health ??= (async (): Promise<SandboxHealth> => {
      const reply = await this.exchange({ kind: 'canary' }, 3_000);
      if (reply === 'timeout' || reply.kind === 'failed') {
        return { safe: false, reason: 'Scripts cannot run in this browser: it does not support the isolated environment they need.' };
      }
      const data = reply.kind === 'message' && typeof reply.data === 'object' && reply.data !== null ? (reply.data as Record<string, unknown>) : {};
      return data['canary'] === 'blocked'
        ? { safe: true }
        : { safe: false, reason: 'Scripts were not run: this browser did not enforce the restrictions of the script sandbox, so they cannot be run safely.' };
    })();
    return this.health;
  }

  private failure(job: ScriptJob, error: string): ScriptOutcome {
    return { ok: false, error, timedOut: false, logs: [], tests: [], env: job.env, request: null };
  }

  /** Creates a fresh sandbox frame, sends one message, and returns the first reply that is not "ready". */
  private exchange(message: Record<string, unknown>, timeoutMs: number): Promise<Reply | 'timeout'> {
    return new Promise((resolve) => {
      const frame = this.document.createElement('iframe');
      frame.setAttribute('sandbox', 'allow-scripts'); // never add allow-same-origin
      frame.setAttribute('aria-hidden', 'true');
      frame.tabIndex = -1;
      frame.style.display = 'none';
      // Absolute, because the frame has an opaque origin and a srcdoc document has no URL of its own to resolve against.
      const bootstrapUrl = new URL(BOOTSTRAP_FILE, this.document.baseURI).href;
      frame.srcdoc = `<meta http-equiv="Content-Security-Policy" content="${sandboxPolicy(bootstrapUrl)}"><script src="${bootstrapUrl}"></script>`;

      const view = this.document.defaultView;
      const finish = (result: Reply | 'timeout'): void => {
        clearTimeout(timer);
        view?.removeEventListener('message', onMessage);
        frame.remove(); // removing the frame stops its worker, even one stuck in a loop
        resolve(result);
      };
      const onMessage = (event: MessageEvent<unknown>): void => {
        if (event.source !== frame.contentWindow) return;
        const reply = event.data as Reply;
        if (typeof reply !== 'object' || reply === null) return;
        if (reply.kind === 'ready') frame.contentWindow?.postMessage(message, '*');
        else if (reply.kind === 'message' || reply.kind === 'failed') finish(reply);
      };
      const timer = setTimeout(() => finish('timeout'), timeoutMs);
      view?.addEventListener('message', onMessage);
      this.document.body.appendChild(frame);
    });
  }
}
