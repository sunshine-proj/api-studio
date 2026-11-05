export type ExecutionErrorKind =
  | 'network'
  | 'possible-cors'
  | 'timeout'
  | 'aborted'
  | 'unsupported'
  | 'invalid-request';

export interface ExecutionError {
  readonly kind: ExecutionErrorKind;
  readonly message: string;
  /** Extra explanation shown to the user, e.g. why CORS cannot be confirmed. */
  readonly hint?: string;
}

export interface ResponseHeader {
  readonly name: string;
  readonly value: string;
}

/** Information the browser could not provide is marked, never invented. */
export type Availability<T> = { readonly available: true; readonly value: T } | { readonly available: false; readonly reason: string };

export interface ResponseBodyInfo {
  readonly contentType: string | null;
  /** Bytes actually received. */
  readonly size: number;
  /** True when the body exceeded the display limit and was not rendered. */
  readonly truncated: boolean;
}

/** Result of an HTTP exchange that produced a response (any status code). */
export interface ApiResponse {
  readonly status: number;
  readonly statusText: string;
  readonly headers: readonly ResponseHeader[];
  readonly body: ResponseBodyInfo;
  readonly durationMs: number;
  readonly url: string;
  readonly redirected: boolean;
  readonly cookies: Availability<readonly string[]>;
}
