/** What assertions, extractions and scripts can see of a response. Plain data, independent of the browser. */
export interface ResponseSnapshot {
  readonly status: number;
  readonly statusText: string;
  /** Header names are lower case. */
  readonly headers: ReadonlyMap<string, string>;
  /** Decoded body, or null when it was too large or not text. */
  readonly bodyText: string | null;
  readonly durationMs: number;
}
