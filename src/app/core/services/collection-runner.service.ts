import { Injectable, computed, inject, signal } from '@angular/core';
import { AssertionResult } from '../testing/assertions.util';
import { ExtractionResult } from '../testing/extraction.util';
import { SavedRequest } from '../models';
import { findFolderNode, requestsInOrder } from '../utils/collection-tree.util';
import { EnvironmentStore } from './environment-store.service';
import { HistoryStore } from './history-store.service';
import { RequestPipeline } from './request-pipeline.service';
import { SavedRequestStore } from './saved-request-store.service';

export type RunStatus = 'idle' | 'running' | 'done' | 'cancelled';

export interface RunItem {
  readonly requestId: string;
  readonly name: string;
  readonly method: string;
  readonly url: string;
  /** HTTP status, or null when no response arrived. */
  readonly status: number | null;
  readonly durationMs: number | null;
  /** Why the request did not complete (network error, script error, no token…). */
  readonly error: string | null;
  readonly checks: readonly AssertionResult[];
  readonly extractions: readonly ExtractionResult[];
  readonly notes: readonly string[];
  /** True when the request completed and every check passed. */
  readonly passed: boolean;
}

export interface RunScope {
  readonly collectionId: string;
  /** Run only this folder (and its subfolders) of the collection. */
  readonly folderId: string | null;
}

/**
 * Runs the saved requests of a collection or folder one after another, in the
 * order shown in the sidebar. Values extracted by one request (or set by its
 * scripts) are available to the next ones, so a run can log in, create
 * something and then check it. Files chosen for upload are not kept in saved
 * requests, so requests that need one fail with that explanation.
 */
@Injectable({ providedIn: 'root' })
export class CollectionRunner {
  private readonly saved = inject(SavedRequestStore);
  private readonly environments = inject(EnvironmentStore);
  private readonly pipeline = inject(RequestPipeline);
  private readonly history = inject(HistoryStore);

  private controller: AbortController | null = null;
  private readonly statusState = signal<RunStatus>('idle');
  private readonly itemsState = signal<readonly RunItem[]>([]);
  private readonly totalState = signal(0);

  readonly status = this.statusState.asReadonly();
  readonly items = this.itemsState.asReadonly();
  readonly total = this.totalState.asReadonly();
  readonly running = computed(() => this.status() === 'running');
  readonly summary = computed(() => {
    const items = this.items();
    return {
      completed: items.length,
      passed: items.filter((i) => i.passed).length,
      failed: items.filter((i) => !i.passed).length,
      checks: items.reduce((n, i) => n + i.checks.length, 0),
      failedChecks: items.reduce((n, i) => n + i.checks.filter((c) => !c.passed).length, 0),
    };
  });

  /** The requests a run of this scope would send, in order. */
  requestsFor(scope: RunScope): readonly SavedRequest[] {
    const node = this.saved.tree().find((n) => n.collection.id === scope.collectionId);
    if (!node) return [];
    if (scope.folderId === null) return requestsInOrder(node);
    const folder = findFolderNode(node.folders, scope.folderId);
    return folder ? requestsInOrder(folder) : [];
  }

  /** Runs the scope. Resolves when it finishes, fails (with stop on failure) or is cancelled. Ignored while another run is going. */
  async run(scope: RunScope, options: { readonly stopOnFailure: boolean }): Promise<void> {
    if (this.running()) return;
    const requests = this.requestsFor(scope);
    const controller = new AbortController();
    this.controller = controller;
    this.itemsState.set([]);
    this.totalState.set(requests.length);
    this.statusState.set('running');

    // A private copy of the variables: extracted values flow from request to request even without a selected environment.
    const variables = new Map(this.environments.variables());

    for (const request of requests) {
      if (controller.signal.aborted) break;
      const output = await this.pipeline.run(request.definition, { variables, signal: controller.signal });
      if (controller.signal.aborted && !output.result.ok && output.result.error.kind === 'aborted') break;
      for (const [name, value] of output.variableUpdates) variables.set(name, value);
      void this.history.record(request.definition, output.result);

      const { result, report } = output;
      const checks = report.checks;
      const item: RunItem = {
        requestId: request.id,
        name: request.name,
        method: request.definition.method,
        url: request.definition.url,
        status: result.ok ? result.response.status : null,
        durationMs: result.ok ? result.response.durationMs : result.durationMs,
        error: result.ok ? null : result.error.message,
        checks,
        extractions: report.extractions,
        notes: report.notes,
        passed: result.ok && checks.every((check) => check.passed),
      };
      this.itemsState.update((list) => [...list, item]);
      if (!item.passed && options.stopOnFailure) break;
    }

    this.statusState.set(controller.signal.aborted ? 'cancelled' : 'done');
    this.controller = null;
  }

  /** Stops after aborting the request in flight. */
  cancel(): void {
    this.controller?.abort();
  }

  reset(): void {
    if (!this.running()) {
      this.itemsState.set([]);
      this.totalState.set(0);
      this.statusState.set('idle');
    }
  }
}
