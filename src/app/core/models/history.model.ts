import { PersistedEntity } from './common.model';
import { ExecutionError } from './response.model';
import { HttpMethod, RequestDefinition } from './request.model';

export interface HistoryEntry extends PersistedEntity {
  /** Redacted snapshot: Authorization and secret values are removed. */
  readonly request: RequestDefinition;
  readonly method: HttpMethod;
  readonly url: string;
  readonly executedAt: number;
  readonly status: number | null;
  readonly durationMs: number | null;
  readonly error: ExecutionError | null;
  /** True when a very large text body was cut short to keep the history small. */
  readonly bodyTruncated?: boolean;
}
