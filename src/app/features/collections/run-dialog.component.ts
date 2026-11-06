import { ChangeDetectionStrategy, Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatCheckbox } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialogActions, MatDialogClose, MatDialogContent, MatDialogTitle } from '@angular/material/dialog';
import { MatProgressBar } from '@angular/material/progress-bar';
import { CollectionRunner, RunScope } from '@core/services/collection-runner.service';
import { formatDuration } from '@core/utils/response.util';

export interface RunDialogData extends RunScope {
  readonly title: string;
}

/** Runs a collection or folder and shows each request's result, assertions and extracted values. */
@Component({
  selector: 'app-run-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButton, MatCheckbox, MatDialogActions, MatDialogClose, MatDialogContent, MatDialogTitle, MatProgressBar],
  template: `
    <h2 mat-dialog-title>Run {{ data.title }}</h2>
    <mat-dialog-content>
      <p class="note">
        {{ requestCount() }} request{{ requestCount() === 1 ? '' : 's' }} will be sent in the order shown in the sidebar
        (folders first). Values extracted by one request are available to the next. Requests that need a file chosen
        for upload will fail, because saved requests do not keep files.
      </p>
      <mat-checkbox [checked]="stopOnFailure()" [disabled]="runner.running()" (change)="stopOnFailure.set($event.checked)">
        Stop at the first failure
      </mat-checkbox>

      @if (runner.status() !== 'idle') {
        <mat-progress-bar
          mode="determinate"
          [value]="percent()"
          aria-label="Run progress"
        />
        <p class="summary" role="status" [class.bad]="runner.summary().failed > 0">
          {{ runner.summary().completed }} of {{ runner.total() }} run ·
          {{ runner.summary().passed }} passed · {{ runner.summary().failed }} failed
          @if (runner.summary().checks > 0) {
            · {{ runner.summary().checks - runner.summary().failedChecks }}/{{ runner.summary().checks }} checks passed
          }
          @if (runner.status() === 'cancelled') {
            · stopped
          }
        </p>

        <ul class="results" aria-label="Results">
          @for (item of runner.items(); track item.requestId) {
            <li>
              <details [open]="!item.passed">
                <summary>
                  <span class="mark" [class.fail]="!item.passed" aria-hidden="true">{{ item.passed ? '✔' : '✘' }}</span>
                  <span class="visually-hidden">{{ item.passed ? 'Passed:' : 'Failed:' }}</span>
                  <span class="method">{{ item.method }}</span>
                  <span class="name">{{ item.name }}</span>
                  <span class="meta">
                    {{ item.status ?? 'no response' }}
                    @if (item.durationMs !== null) {
                      · {{ duration(item.durationMs) }}
                    }
                  </span>
                </summary>
                <div class="detail">
                  @if (item.error) {
                    <p class="fail">{{ item.error }}</p>
                  }
                  @for (check of item.checks; track $index) {
                    <p [class.fail]="!check.passed">
                      {{ check.passed ? '✔' : '✘' }} {{ check.label }}@if (check.message) { — {{ check.message }} }
                    </p>
                  }
                  @for (extraction of item.extractions; track extraction.id) {
                    <p [class.fail]="!extraction.ok">
                      {{ extraction.ok ? '→' : '✘' }} <code>{{ extraction.variable }}</code>
                      {{ extraction.ok ? (extraction.secret ? '(secret value saved)' : '= ' + extraction.value) : extraction.message }}
                    </p>
                  }
                  @for (note of item.notes; track $index) {
                    <p class="muted">{{ note }}</p>
                  }
                  @if (!item.error && item.checks.length === 0 && item.extractions.length === 0) {
                    <p class="muted">No assertions or extractions on this request.</p>
                  }
                </div>
              </details>
            </li>
          }
        </ul>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" mat-dialog-close>Close</button>
      @if (runner.running()) {
        <button mat-stroked-button type="button" (click)="runner.cancel()">Stop</button>
      } @else {
        <button mat-flat-button type="button" [disabled]="requestCount() === 0" (click)="start()">
          {{ runner.status() === 'idle' ? 'Run' : 'Run again' }}
        </button>
      }
    </mat-dialog-actions>
  `,
  styles: `
    mat-dialog-content {
      min-width: 560px;
      max-width: 760px;
    }
    .note {
      margin: 0 0 8px;
      color: var(--mat-sys-on-surface-variant);
    }
    .summary {
      margin: 8px 0;
      font-weight: 600;
      color: var(--app-success);
    }
    .summary.bad {
      color: var(--mat-sys-error);
    }
    .results {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    li {
      border-bottom: 1px solid var(--mat-sys-outline-variant);
    }
    summary {
      display: flex;
      gap: 8px;
      align-items: baseline;
      padding: 4px 0;
      cursor: pointer;
    }
    .mark {
      width: 16px;
      color: var(--app-success);
    }
    .mark.fail,
    .fail {
      color: var(--mat-sys-error);
    }
    .method {
      color: var(--mat-sys-primary);
      font: var(--mat-sys-label-small);
      font-weight: 600;
    }
    .name {
      flex: 1 1 auto;
    }
    .meta,
    .muted {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    .detail {
      padding: 0 0 6px 24px;
      p {
        margin: 2px 0;
      }
    }
    .visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
    }
  `,
})
export class RunDialogComponent implements OnDestroy {
  protected readonly data = inject<RunDialogData>(MAT_DIALOG_DATA);
  protected readonly runner = inject(CollectionRunner);
  protected readonly stopOnFailure = signal(false);
  protected readonly duration = formatDuration;

  protected readonly requestCount = computed(() => this.runner.requestsFor(this.data).length);
  protected readonly percent = computed(() => {
    const total = this.runner.total();
    return total === 0 ? 0 : (this.runner.items().length / total) * 100;
  });

  constructor() {
    this.runner.reset();
  }

  protected start(): void {
    void this.runner.run(this.data, { stopOnFailure: this.stopOnFailure() });
  }

  ngOnDestroy(): void {
    this.runner.cancel(); // closing the dialog stops a run in progress
  }
}
