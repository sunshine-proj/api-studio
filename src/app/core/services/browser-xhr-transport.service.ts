import { Injectable } from '@angular/core';
import { ApiResponse, ExecutionResult, PreparedRequest, ResponseHeader } from '../models';
import { toBodyInit } from '../utils/body-builder.util';
import { MAX_RESPONSE_BYTES } from '../utils/response.util';
import { ExecutionContext } from './request-execution.service';
import { abortedError, failure, networkFailure, timeoutError } from './execution-support';

/**
 * Sends an already prepared request with XMLHttpRequest. It exists only because
 * Fetch cannot report upload progress; `BrowserFetchExecutor` delegates to it
 * for file uploads.
 *
 * Differences from Fetch that this transport cannot hide: XHR always follows
 * redirects, always sends cookies to same-origin URLs, and buffers the whole
 * response before handing it over (so the size limit is applied afterwards).
 */
@Injectable({ providedIn: 'root' })
export class BrowserXhrTransport {
  send(request: PreparedRequest, warnings: readonly string[], context: ExecutionContext): Promise<ExecutionResult> {
    const notes = [...warnings];
    if (request.options.redirect !== 'follow') {
      notes.push('Uploads with progress always follow redirects, so the redirect option was ignored.');
    }

    return new Promise<ExecutionResult>((resolve) => {
      if (context.signal?.aborted) {
        resolve(failure(request, notes, null, abortedError()));
        return;
      }

      const xhr = new XMLHttpRequest();
      const started = performance.now();
      const elapsed = (): number => performance.now() - started;
      const abort = (): void => xhr.abort();
      const finish = (result: ExecutionResult): void => {
        context.signal?.removeEventListener('abort', abort);
        resolve(result);
      };

      xhr.open(request.method, request.url, true);
      xhr.responseType = 'blob';
      xhr.timeout = request.options.timeoutMs;
      xhr.withCredentials = request.options.credentials === 'include';
      for (const header of request.headers) {
        xhr.setRequestHeader(header.name, header.value);
      }

      xhr.upload.onprogress = (event: ProgressEvent): void =>
        context.onUploadProgress?.({ loaded: event.loaded, total: event.lengthComputable ? event.total : null });

      xhr.onload = (): void => {
        const received: Blob = xhr.response instanceof Blob ? xhr.response : new Blob([]);
        const truncated = received.size > MAX_RESPONSE_BYTES;
        const body = truncated ? received.slice(0, MAX_RESPONSE_BYTES) : received;
        const extra = truncated
          ? [...notes, 'The response exceeded the size limit and was cut off. Only the received part is kept.']
          : notes;
        const response: ApiResponse = {
          status: xhr.status,
          statusText: xhr.statusText,
          headers: parseHeaders(xhr.getAllResponseHeaders()),
          body: { contentType: xhr.getResponseHeader('content-type'), size: body.size, truncated },
          durationMs: elapsed(),
          url: xhr.responseURL || request.url,
          redirected: xhr.responseURL !== '' && xhr.responseURL !== request.url,
          cookies: {
            available: false,
            reason: 'Browsers do not expose Set-Cookie response headers to JavaScript.',
          },
        };
        finish({ ok: true, response, body, request, warnings: extra });
      };
      xhr.onerror = (): void => finish(failure(request, notes, elapsed(), networkFailure(request)));
      xhr.ontimeout = (): void => finish(failure(request, notes, elapsed(), timeoutError(request)));
      xhr.onabort = (): void => finish(failure(request, notes, elapsed(), abortedError()));

      context.signal?.addEventListener('abort', abort, { once: true });
      xhr.send(toBodyInit(request.body) ?? null);
    });
  }
}

/** Parses the raw header block XHR returns into name/value pairs. */
export function parseHeaders(raw: string): readonly ResponseHeader[] {
  const headers: ResponseHeader[] = [];
  for (const line of raw.trim().split(/[\r\n]+/)) {
    const separator = line.indexOf(':');
    if (separator > 0) {
      headers.push({ name: line.slice(0, separator).trim(), value: line.slice(separator + 1).trim() });
    }
  }
  return headers;
}
