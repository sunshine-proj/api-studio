import { ExecutionResult, RequestDefinition, UploadProgress } from '../models';
import { FileMap } from '../utils/request-preparation.util';
import { VariableMap } from '../utils/variable.util';

export interface ExecutionContext {
  /** Variables available for `{{name}}` resolution (the active environment). */
  readonly variables: VariableMap;
  /** Files the user selected, by multipart row id or the binary body key. */
  readonly files?: FileMap;
  /** Aborting this signal cancels the request. */
  readonly signal?: AbortSignal;
  /**
   * When set and the request uploads files, the executor reports progress.
   * This requires XMLHttpRequest, because Fetch cannot observe uploads.
   */
  readonly onUploadProgress?: (progress: UploadProgress) => void;
}

/**
 * The single entry point for running HTTP requests. UI code depends on this
 * contract only, so a different executor (for example an optional backend one)
 * can replace the browser implementation without touching components.
 *
 * Implementations never reject: every outcome is an `ExecutionResult`.
 */
export abstract class RequestExecutionService {
  abstract execute(definition: RequestDefinition, context: ExecutionContext): Promise<ExecutionResult>;
}
