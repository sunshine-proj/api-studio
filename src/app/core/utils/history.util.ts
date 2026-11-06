import { ExecutionResult, HistoryEntry, RequestDefinition, SCHEMA_VERSION } from '../models';
import { SecretVariable, limitBodySize, redactDefinition } from './redaction.util';

/**
 * Builds the history record of an execution, or null when nothing should be
 * recorded: a request that was never sent (invalid) or that the user cancelled.
 * The request is redacted and size-limited before it is returned.
 */
export function createHistoryEntry(
  definition: RequestDefinition,
  result: ExecutionResult,
  secrets: readonly SecretVariable[],
  id: string,
  now: number,
): HistoryEntry | null {
  if (!result.ok && (result.error.kind === 'aborted' || result.error.kind === 'invalid-request')) {
    return null;
  }
  const { definition: request, truncated } = limitBodySize(redactDefinition(definition, secrets));
  return {
    id,
    schemaVersion: SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
    request,
    method: request.method,
    url: request.url,
    executedAt: now,
    status: result.ok ? result.response.status : null,
    durationMs: result.ok ? result.response.durationMs : result.durationMs,
    error: result.ok ? null : result.error,
    ...(truncated ? { bodyTruncated: true } : {}),
  };
}
