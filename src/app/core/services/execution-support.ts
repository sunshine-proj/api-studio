import { ExecutionError, ExecutionFailure, PreparedRequest } from '../models';

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]']);

export function failure(
  request: PreparedRequest,
  warnings: readonly string[],
  durationMs: number | null,
  error: ExecutionError,
): ExecutionFailure {
  return { ok: false, error, request, durationMs, warnings };
}

export function timeoutError(request: PreparedRequest): ExecutionError {
  return {
    kind: 'timeout',
    message: `The request timed out after ${request.options.timeoutMs / 1000} seconds.`,
    hint: 'Increase the timeout in the request options if the server is slow.',
  };
}

export function abortedError(): ExecutionError {
  return { kind: 'aborted', message: 'The request was cancelled.' };
}

/**
 * Browsers report DNS errors, refused connections, mixed content and CORS
 * rejections all as the same opaque failure, so the cause can only be
 * inferred. The wording says so instead of claiming certainty.
 */
export function networkFailure(request: PreparedRequest): ExecutionError {
  const target = new URL(request.url);
  const page = globalThis.location as Location | undefined;

  if (page && page.protocol === 'https:' && target.protocol === 'http:' && !LOOPBACK_HOSTS.has(target.hostname)) {
    return {
      kind: 'network',
      message: 'The request failed. It was probably blocked as mixed content.',
      hint: 'This page is served over HTTPS, and browsers block requests from it to insecure http:// addresses. Use https:// or run API Studio over http://.',
    };
  }
  if (page && target.origin !== page.origin) {
    return {
      kind: 'possible-cors',
      message: 'The request failed. This is possibly a CORS problem.',
      hint: 'Browsers hide the exact reason. The server may be unreachable, the certificate invalid, or it may not allow requests from this origin (missing Access-Control-Allow-Origin header, or a failed preflight). Check the browser developer tools for details.',
    };
  }
  return {
    kind: 'network',
    message: 'The request failed before a response was received.',
    hint: 'The server may be unreachable, refused the connection, or the address could not be resolved.',
  };
}
