import { ApiResponse, ExecutionError } from './response.model';
import { HttpMethod, RequestOptions } from './request.model';

export interface PreparedHeader {
  readonly name: string;
  readonly value: string;
}

export type PreparedFormField =
  | { readonly kind: 'text'; readonly name: string; readonly value: string }
  | { readonly kind: 'file'; readonly name: string; readonly blob: Blob; readonly filename: string };

/** URL-encoded forms are serialized during preparation and travel as `text`. */
export type PreparedBody =
  | { readonly type: 'none' }
  | { readonly type: 'text'; readonly content: string }
  | { readonly type: 'multipart'; readonly fields: readonly PreparedFormField[] }
  | { readonly type: 'binary'; readonly blob: Blob };

export interface UploadProgress {
  readonly loaded: number;
  /** Null when the total size is unknown. */
  readonly total: number | null;
}

/** A request after normalization and variable resolution, ready to be sent. */
export interface PreparedRequest {
  readonly method: HttpMethod;
  readonly url: string;
  readonly headers: readonly PreparedHeader[];
  readonly body: PreparedBody;
  readonly options: RequestOptions;
}

export type PreparationResult =
  | { readonly ok: true; readonly request: PreparedRequest; readonly warnings: readonly string[] }
  | { readonly ok: false; readonly error: ExecutionError; readonly warnings: readonly string[] };

export interface ExecutionSuccess {
  readonly ok: true;
  readonly response: ApiResponse;
  /** Received body bytes. Empty for HEAD or empty responses. */
  readonly body: Blob;
  /** The request as it was actually sent. */
  readonly request: PreparedRequest;
  readonly warnings: readonly string[];
}

export interface ExecutionFailure {
  readonly ok: false;
  readonly error: ExecutionError;
  readonly request: PreparedRequest | null;
  /** Time until the failure, or null when nothing was sent. */
  readonly durationMs: number | null;
  readonly warnings: readonly string[];
}

/** An HTTP error status is a successful execution; only transport problems fail. */
export type ExecutionResult = ExecutionSuccess | ExecutionFailure;
