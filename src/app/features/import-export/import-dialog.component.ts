import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatDialogActions, MatDialogClose, MatDialogContent, MatDialogTitle } from '@angular/material/dialog';
import { MatProgressBar } from '@angular/material/progress-bar';
import { IMPORT_FORMAT_LABELS } from '@core/import-export/import-bundle.model';
import { ImportError } from '@core/import-export/safe-json.util';
import { ImportExportService, ImportPreview } from '@core/services/import-export.service';

type Status = 'choose' | 'reading' | 'ready' | 'importing' | 'done';

/** Imports an API Studio export, a Postman collection or an OpenAPI description, after showing what it contains. */
@Component({
  selector: 'app-import-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButton, MatDialogActions, MatDialogClose, MatDialogContent, MatDialogTitle, MatProgressBar],
  template: `
    <h2 mat-dialog-title>Import</h2>
    <mat-dialog-content>
      <p class="note">
        Supports API Studio exports, Postman collections (v2) and OpenAPI 3.x / Swagger 2.0 in JSON (not YAML). Imported
        data is added next to your existing data; nothing is overwritten. Scripts in imported files are never run.
      </p>

      <label class="field">
        File
        <input
          type="file"
          accept=".json,application/json"
          [disabled]="status() === 'reading' || status() === 'importing' || status() === 'done'"
          (change)="choose($event)"
        />
      </label>

      @if (status() === 'reading' || status() === 'importing') {
        <mat-progress-bar mode="indeterminate" [attr.aria-label]="status() === 'reading' ? 'Reading the file' : 'Importing'" />
        <p class="note" role="status">{{ status() === 'reading' ? 'Reading the file…' : 'Importing…' }}</p>
      }

      @if (error(); as message) {
        <p class="error" role="alert">{{ message }}</p>
      }

      @if (preview(); as p) {
        <section aria-label="Import summary">
          <h3>{{ labels[p.format] }}</h3>
          <ul class="counts">
            <li>{{ p.bundle.collections.length }} collection{{ p.bundle.collections.length === 1 ? '' : 's' }}</li>
            <li>{{ p.bundle.folders.length }} folder{{ p.bundle.folders.length === 1 ? '' : 's' }}</li>
            <li>{{ p.bundle.requests.length }} request{{ p.bundle.requests.length === 1 ? '' : 's' }}</li>
            <li>{{ p.bundle.environments.length }} environment{{ p.bundle.environments.length === 1 ? '' : 's' }}</li>
          </ul>
          @if (p.bundle.warnings.length > 0) {
            <h4>Please note</h4>
            <ul class="warnings" aria-label="Import warnings">
              @for (warning of p.bundle.warnings; track $index) {
                <li>{{ warning }}</li>
              }
            </ul>
          }
        </section>
      }

      @if (status() === 'done') {
        <p class="success" role="status">Import complete. The imported collections are in the sidebar.</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      @if (status() === 'done') {
        <button mat-flat-button type="button" mat-dialog-close>Done</button>
      } @else {
        <button mat-button type="button" mat-dialog-close [disabled]="status() === 'importing'">Cancel</button>
        <button mat-flat-button type="button" [disabled]="!canImport()" (click)="confirm()">Import</button>
      }
    </mat-dialog-actions>
  `,
  styles: `
    mat-dialog-content {
      min-width: 480px;
      max-width: 640px;
    }
    .note {
      color: var(--mat-sys-on-surface-variant);
    }
    .field {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin-bottom: 12px;
    }
    h3 {
      margin: 12px 0 4px;
      font: var(--mat-sys-title-small);
    }
    h4 {
      margin: 8px 0 4px;
      font: var(--mat-sys-label-large);
    }
    .counts {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 20px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .warnings {
      margin: 0;
      padding: 8px 12px 8px 28px;
      color: var(--mat-sys-on-tertiary-container);
      background: var(--mat-sys-tertiary-container);
      border-radius: 8px;
    }
    .error {
      color: var(--mat-sys-error);
    }
    .success {
      color: var(--mat-sys-primary);
      font-weight: 600;
    }
  `,
})
export class ImportDialogComponent {
  private readonly service = inject(ImportExportService);

  protected readonly labels = IMPORT_FORMAT_LABELS;
  protected readonly status = signal<Status>('choose');
  protected readonly preview = signal<ImportPreview | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly canImport = computed(() => {
    const p = this.preview();
    return this.status() === 'ready' && p !== null && (p.bundle.collections.length > 0 || p.bundle.environments.length > 0);
  });

  protected async choose(event: Event): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.item(0);
    this.preview.set(null);
    this.error.set(null);
    if (!file) {
      this.status.set('choose');
      return;
    }
    this.status.set('reading');
    try {
      this.preview.set(await this.service.readFile(file));
      this.status.set('ready');
    } catch (error) {
      // ImportError messages are written for users; anything else gets a generic message.
      this.error.set(error instanceof ImportError ? error.message : 'The file could not be read.');
      this.status.set('choose');
    }
  }

  protected async confirm(): Promise<void> {
    const p = this.preview();
    if (!p || this.status() !== 'ready') return;
    this.status.set('importing');
    const result = await this.service.commit(p.bundle);
    if (result.ok) {
      this.status.set('done');
    } else {
      this.error.set(result.message);
      this.status.set('ready');
    }
  }
}
