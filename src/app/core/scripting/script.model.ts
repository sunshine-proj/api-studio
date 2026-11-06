export type ScriptPhase = 'pre-request' | 'test';

/** The request as a script sees and may change it. Plain data only. */
export interface ScriptRequestView {
  method: string;
  url: string;
  /** Header name to value. Only enabled headers are shown. */
  headers: Record<string, string>;
  /** Text body, or null when the request has no text body. */
  body: string | null;
}

export interface ScriptResponseView {
  readonly status: number;
  readonly statusText: string;
  /** Header names are lower case. */
  readonly headers: Readonly<Record<string, string>>;
  /** Decoded body, or null when it was too large or not text. */
  readonly body: string | null;
  readonly time: number;
}

export interface ScriptJob {
  readonly phase: ScriptPhase;
  readonly source: string;
  readonly request: ScriptRequestView;
  readonly response: ScriptResponseView | null;
  /** Variables of the active environment, readable and writable by the script. */
  readonly env: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
}

export interface ScriptTestResult {
  readonly name: string;
  readonly passed: boolean;
  readonly message: string;
}

export interface ScriptOutcome {
  /** False when the script could not run or threw; `error` says why. */
  readonly ok: boolean;
  readonly error: string | null;
  readonly timedOut: boolean;
  readonly logs: readonly string[];
  readonly tests: readonly ScriptTestResult[];
  /** The variables after the script ran. */
  readonly env: Readonly<Record<string, string>>;
  /** The request after the script ran (pre-request scripts only). */
  readonly request: ScriptRequestView | null;
}

export const DEFAULT_SCRIPT_TIMEOUT_MS = 5_000;
