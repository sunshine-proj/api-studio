import { Injectable, InjectionToken, inject } from '@angular/core';
import {
  ApiResponse,
  ExecutionError,
  ExecutionResult,
  PreparedRequest,
  RequestDefinition,
  ResponseHeader,
} from '../models';
import { isUploadBody, toBodyInit } from '../utils/body-builder.util';
import { prepareRequest } from '../utils/request-preparation.util';
import { MAX_RESPONSE_BYTES } from '../utils/response.util';
import { BrowserXhrTransport } from './browser-xhr-transport.service';
import { abortedError, failure, networkFailure, timeoutError } from './execution-support';
import { ExecutionContext, RequestExecutionService } from './request-execution.service';

/** Overridable in tests. Resolved lazily so the global is not captured early. */
export const FETCH_IMPLEMENTATION = new InjectionToken<typeof fetch>('FETCH_IMPLEMENTATION', {
  providedIn: 'root',
  factory: () => (input, init) => globalThis.fetch(input, init),
});

interface ReadBody {
  readonly blob: Blob;
  readonly size: number;
  readonly truncated: boolean;
}

@Injectable({ providedIn: 'root' })
export class BrowserFetchExecutor extends RequestExecutionService {
  private readonly fetchImpl = inject(FETCH_IMPLEMENTATION);
  private readonly xhr = inject(BrowserXhrTransport);

  async execute(definition: RequestDefinition, context: ExecutionContext): Promise<ExecutionResult> {
    const prepared = prepareRequest(definition, context.variables, context.files);
    if (!prepared.ok) {
      return { ok: false, error: prepared.error, request: null, durationMs: null, warnings: prepared.warnings };
    }
    const { request, warnings } = prepared;

    // Fetch cannot report upload progress, so file uploads go through XHR when progress is wanted.
    if (context.onUploadProgress && isUploadBody(request.body)) {
      return this.xhr.send(request, warnings, context);
    }

    if (typeof globalThis.fetch !== 'function') {
      return failure(request, warnings, null, {
        kind: 'unsupported',
        message: 'This browser does not support the Fetch API.',
      });
    }
    if (context.signal?.aborted) {
      return failure(request, warnings, null, abortedError());
    }

    const controller = new AbortController();
    const forwardAbort = (): void => controller.abort();
    context.signal?.addEventListener('abort', forwardAbort, { once: true });
    let timedOut = false;
    const timer =
      request.options.timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            controller.abort();
          }, request.options.timeoutMs)
        : undefined;

    const started = performance.now();
    try {
      const response = await this.fetchImpl(request.url, {
        method: request.method,
        headers: request.headers.map((header): [string, string] => [header.name, header.value]),
        body: toBodyInit(request.body),
        redirect: request.options.redirect,
        credentials: request.options.credentials,
        signal: controller.signal,
      });
      const body = await readBody(response, request.method);
      const durationMs = performance.now() - started;

      const extraWarnings = [...warnings];
      if (response.type === 'opaqueredirect') {
        extraWarnings.push(
          'The server answered with a redirect that was not followed. Browsers hide its status and headers.',
        );
      }
      if (body.truncated) {
        extraWarnings.push('The response exceeded the size limit and was cut off. Only the received part is kept.');
      }

      const apiResponse: ApiResponse = {
        status: response.status,
        statusText: response.statusText,
        headers: collectHeaders(response.headers),
        body: { contentType: response.headers.get('content-type'), size: body.size, truncated: body.truncated },
        durationMs,
        url: response.url || request.url,
        redirected: response.redirected,
        cookies: {
          available: false,
          reason: 'Browsers do not expose Set-Cookie response headers to JavaScript.',
        },
      };
      return { ok: true, response: apiResponse, body: body.blob, request, warnings: extraWarnings };
    } catch (error) {
      const durationMs = performance.now() - started;
      const classified = classifyError(error, request, timedOut, context.signal?.aborted === true);
      return failure(request, warnings, durationMs, classified);
    } finally {
      clearTimeout(timer);
      context.signal?.removeEventListener('abort', forwardAbort);
    }
  }
}

function collectHeaders(headers: Headers): readonly ResponseHeader[] {
  const result: ResponseHeader[] = [];
  headers.forEach((value, name) => result.push({ name, value }));
  return result;
}

/** Streams the body so oversized responses can be cut off instead of exhausting memory. */
async function readBody(response: Response, method: string): Promise<ReadBody> {
  if (response.body === null || method.toUpperCase() === 'HEAD') {
    return { blob: new Blob([]), size: 0, truncated: false };
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = value as Uint8Array<ArrayBuffer>;
    if (size + chunk.byteLength > MAX_RESPONSE_BYTES) {
      const allowed = MAX_RESPONSE_BYTES - size;
      chunks.push(chunk.slice(0, allowed));
      size += allowed;
      truncated = true;
      await reader.cancel();
      break;
    }
    chunks.push(chunk);
    size += chunk.byteLength;
  }
  return { blob: new Blob(chunks), size, truncated };
}

function classifyError(
  error: unknown,
  request: PreparedRequest,
  timedOut: boolean,
  cancelledByUser: boolean,
): ExecutionError {
  if (timedOut) {
    return timeoutError(request);
  }
  if (cancelledByUser || (error instanceof DOMException && error.name === 'AbortError')) {
    return abortedError();
  }
  if (error instanceof TypeError) {
    return networkFailure(request);
  }
  const message = error instanceof Error ? error.message : 'The request failed for an unknown reason.';
  return { kind: 'network', message };
}
