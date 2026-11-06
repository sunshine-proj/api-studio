import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatDialogActions, MatDialogClose, MatDialogContent, MatDialogRef, MatDialogTitle } from '@angular/material/dialog';
import { HistoryStore } from '@core/services/history-store.service';
import { SettingsStore } from '@core/services/settings-store.service';
import { MAX_HISTORY_LIMIT, MAX_RENDER_BYTES } from '@core/utils/settings.util';

const MB = 1024 * 1024;

/** Limits for response display and request history. */
@Component({
  selector: 'app-settings-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButton, MatDialogActions, MatDialogClose, MatDialogContent, MatDialogTitle],
  template: `
    <h2 mat-dialog-title>Settings</h2>
    <form (submit)="save($event)">
      <mat-dialog-content>
        <label class="field">
          Largest response shown (MB)
          <input name="renderMb" type="number" min="1" [max]="maxRenderMb" step="1" [value]="renderMb" [attr.aria-invalid]="error() !== null" />
          <span class="help">
            Larger bodies are not displayed and can only be downloaded. Responses above {{ maxRenderMb }} MB are cut off
            while receiving.
          </span>
        </label>
        <label class="field">
          History entries kept
          <input name="history" type="number" min="1" [max]="maxHistory" step="1" [value]="historyLimit" [attr.aria-invalid]="error() !== null" />
          <span class="help">The oldest entries are deleted first when this is exceeded.</span>
        </label>
        <p class="error" role="alert">{{ error() }}</p>
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" mat-dialog-close>Cancel</button>
        <button mat-flat-button type="submit">Save</button>
      </mat-dialog-actions>
    </form>
  `,
  styles: `
    .field {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 360px;
      margin-bottom: 12px;
    }
    input {
      height: 34px;
      padding: 0 8px;
      font: inherit;
      color: inherit;
      background: transparent;
      border: 1px solid var(--mat-sys-outline);
      border-radius: 4px;
    }
    .help {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    .error {
      min-height: 1.2em;
      margin: 0;
      color: var(--mat-sys-error);
    }
  `,
})
export class SettingsDialogComponent {
  private readonly settings = inject(SettingsStore);
  private readonly history = inject(HistoryStore);
  private readonly ref = inject<MatDialogRef<SettingsDialogComponent>>(MatDialogRef);

  protected readonly maxRenderMb = MAX_RENDER_BYTES / MB;
  protected readonly maxHistory = MAX_HISTORY_LIMIT;
  protected readonly renderMb = Math.round(this.settings.settings().maxRenderedResponseBytes / MB);
  protected readonly historyLimit = this.settings.settings().historyLimit;
  protected readonly error = signal<string | null>(null);

  protected async save(event: Event): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.target as HTMLFormElement);
    const renderMb = Number(form.get('renderMb'));
    const historyLimit = Number(form.get('history'));
    if (!Number.isInteger(renderMb) || renderMb < 1 || renderMb > this.maxRenderMb) {
      this.error.set(`Enter a whole number of megabytes from 1 to ${this.maxRenderMb}.`);
      return;
    }
    if (!Number.isInteger(historyLimit) || historyLimit < 1 || historyLimit > this.maxHistory) {
      this.error.set(`Enter a whole number of history entries from 1 to ${this.maxHistory}.`);
      return;
    }
    const saved = await this.settings.update({ maxRenderedResponseBytes: renderMb * MB, historyLimit });
    if (!saved) return; // the storage banner explains why
    await this.history.enforceLimit();
    this.ref.close();
  }
}
