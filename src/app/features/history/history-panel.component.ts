import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { ExecutionErrorKind, HistoryEntry } from '@core/models';
import { HistoryStore } from '@core/services/history-store.service';
import { RequestSession } from '@core/services/request-session.service';
import { formatDuration } from '@core/utils/response.util';
import { ConfirmDialogComponent, ConfirmDialogData } from '@shared/components/dialogs/confirm-dialog.component';

const ERROR_LABELS: Readonly<Record<ExecutionErrorKind, string>> = {
  network: 'Network error',
  'possible-cors': 'Network error, possibly CORS',
  timeout: 'Timed out',
  aborted: 'Cancelled',
  unsupported: 'Unsupported',
  'invalid-request': 'Invalid request',
};

/** Previously sent requests, newest first. Opening one puts a copy in a new tab. */
@Component({
  selector: 'app-history-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, MatButton],
  template: `
    <div class="head">
      <h2>History</h2>
      <button mat-stroked-button type="button" [disabled]="store.entries().length === 0" (click)="clear()">Clear</button>
    </div>
    <p class="note">
      Authorization headers, credentials and values of secret variables are not kept here. Reopened requests may need
      them entered again.
    </p>

    @if (!store.loaded()) {
      <p class="hint" role="status">Loading…</p>
    } @else if (store.entries().length === 0) {
      <p class="hint">Requests you send appear here.</p>
    } @else {
      <ul>
        @for (entry of store.entries(); track entry.id) {
          <li>
            <button
              type="button"
              class="entry"
              [attr.aria-label]="'Open ' + entry.method + ' ' + entry.url"
              (click)="open(entry)"
            >
              <span class="line">
                <span class="method">{{ entry.method }}</span>
                <span class="url" [title]="entry.url">{{ entry.url || '(no URL)' }}</span>
              </span>
              <span class="meta">
                <span [class]="'result ' + resultClass(entry)">{{ result(entry) }}</span>
                @if (entry.durationMs !== null) {
                  <span>{{ duration(entry.durationMs) }}</span>
                }
                <span>{{ entry.executedAt | date: 'short' }}</span>
              </span>
            </button>
            <button type="button" class="remove" [attr.aria-label]="'Remove ' + entry.method + ' ' + entry.url + ' from history'" (click)="store.remove(entry.id)">×</button>
          </li>
        }
      </ul>
    }
  `,
  styles: `
    :host {
      display: block;
      padding: 8px;
    }
    .head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 4px 4px 0;
      h2 {
        margin: 0;
        font: var(--mat-sys-title-small);
      }
    }
    .note,
    .hint {
      margin: 8px 4px;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    ul {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    li {
      display: flex;
      align-items: flex-start;
      border-radius: 4px;
      &:hover {
        background: var(--mat-sys-surface-container-highest);
      }
    }
    button {
      color: inherit;
      font: inherit;
      background: transparent;
      border: 0;
      cursor: pointer;
      &:focus-visible {
        outline: 2px solid var(--mat-sys-primary);
        outline-offset: -2px;
      }
    }
    .entry {
      flex: 1 1 auto;
      min-width: 0;
      padding: 6px 4px;
      text-align: left;
    }
    .line {
      display: flex;
      gap: 6px;
    }
    .method {
      flex: 0 0 auto;
      color: var(--mat-sys-primary);
      font: var(--mat-sys-label-small);
      font-weight: 600;
    }
    .url {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    .result {
      font-weight: 600;
    }
    .result.ok {
      color: #2e7d32;
    }
    .result.client-error,
    .result.redirect {
      color: #ef6c00;
    }
    .result.server-error,
    .result.failed {
      color: var(--mat-sys-error);
    }
    .remove {
      flex: 0 0 auto;
      width: 28px;
      height: 28px;
      margin-top: 4px;
      font-size: 16px;
      border-radius: 4px;
    }
  `,
})
export class HistoryPanelComponent {
  protected readonly store = inject(HistoryStore);
  private readonly session = inject(RequestSession);
  private readonly dialog = inject(MatDialog);

  protected readonly duration = formatDuration;

  protected open(entry: HistoryEntry): void {
    this.session.openDraft(entry.request);
  }

  protected result(entry: HistoryEntry): string {
    if (entry.status !== null) return String(entry.status);
    return entry.error ? ERROR_LABELS[entry.error.kind] : 'No response';
  }

  protected resultClass(entry: HistoryEntry): string {
    const status = entry.status;
    if (status === null) return 'failed';
    if (status >= 500) return 'server-error';
    if (status >= 400) return 'client-error';
    if (status >= 300) return 'redirect';
    return 'ok';
  }

  protected async clear(): Promise<void> {
    const data: ConfirmDialogData = {
      title: 'Clear history?',
      message: `All ${this.store.entries().length} history entries will be permanently deleted. Saved requests are not affected.`,
      confirmLabel: 'Clear history',
    };
    const confirmed = await firstValueFrom(
      this.dialog.open<ConfirmDialogComponent, ConfirmDialogData, boolean>(ConfirmDialogComponent, { data }).afterClosed(),
    );
    if (confirmed === true) await this.store.clear();
  }
}
