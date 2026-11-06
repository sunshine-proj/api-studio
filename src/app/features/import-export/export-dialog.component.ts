import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatCheckbox } from '@angular/material/checkbox';
import { MatDialog, MatDialogActions, MatDialogClose, MatDialogContent, MatDialogRef, MatDialogTitle } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { CollectionStore } from '@core/services/collection-store.service';
import { ExportFile, ImportExportService } from '@core/services/import-export.service';
import { downloadBlob } from '@core/utils/download';
import { ConfirmDialogComponent, ConfirmDialogData } from '@shared/components/dialogs/confirm-dialog.component';

type Format = 'native' | 'postman';

/**
 * Exports collections. Credentials and secret values are left out unless the
 * user ticks the box, and including them asks for a second confirmation.
 */
@Component({
  selector: 'app-export-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButton, MatCheckbox, MatDialogActions, MatDialogClose, MatDialogContent, MatDialogTitle],
  template: `
    <h2 mat-dialog-title>Export</h2>
    <mat-dialog-content>
      <fieldset class="group">
        <legend>Format</legend>
        <label><input type="radio" name="format" value="native" [checked]="format() === 'native'" (change)="format.set('native')" /> API Studio JSON (collections and environments)</label>
        <label><input type="radio" name="format" value="postman" [checked]="format() === 'postman'" (change)="format.set('postman')" /> Postman collection v2.1 (one collection)</label>
      </fieldset>

      @if (collections().length === 0 && format() === 'postman') {
        <p class="note">There are no collections to export.</p>
      } @else if (format() === 'native') {
        <fieldset class="group">
          <legend>Collections</legend>
          @for (collection of collections(); track collection.id) {
            <mat-checkbox [checked]="selected().has(collection.id)" (change)="toggle(collection.id, $event.checked)">{{ collection.name }}</mat-checkbox>
          }
          @if (collections().length === 0) {
            <p class="note">There are no collections yet.</p>
          }
          <mat-checkbox [checked]="includeEnvironments()" (change)="includeEnvironments.set($event.checked)">Include environments</mat-checkbox>
        </fieldset>
      } @else {
        <label class="field">
          Collection
          <select (change)="postmanChoice.set($any($event.target).value)">
            @for (collection of collections(); track collection.id) {
              <option [value]="collection.id" [selected]="collection.id === postmanId()">{{ collection.name }}</option>
            }
          </select>
        </label>
        <p class="note">Environments are not part of the Postman collection format and are not exported.</p>
      }

      <fieldset class="group">
        <legend>Sensitive data</legend>
        @if (sensitivity().secretVariables > 0 || sensitivity().requestsWithCredentials > 0) {
          <p class="warning" role="note">{{ summary() }}</p>
        } @else {
          <p class="note">No credentials or secret variables were found in this selection.</p>
        }
        <mat-checkbox [checked]="includeSecrets()" (change)="includeSecrets.set($event.checked)">
          Include credentials and secret values
        </mat-checkbox>
        <p [class]="includeSecrets() ? 'warning' : 'note'">
          @if (includeSecrets()) {
            The file will contain them <strong>in plain text</strong>. Anyone who gets the file can use them. Share it only
            with people you trust.
          } @else {
            By default they are removed: credentials are emptied and secret values are replaced by their
            <code ngNonBindable>{{name}}</code> placeholder. Environment values not marked secret are exported as they are.
          }
        </p>
      </fieldset>
      @if (error(); as message) {
        <p class="warning" role="alert">{{ message }}</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" mat-dialog-close>Cancel</button>
      <button mat-flat-button type="button" [disabled]="!canExport()" (click)="run()">Export</button>
    </mat-dialog-actions>
  `,
  styles: `
    mat-dialog-content {
      min-width: 480px;
      max-width: 640px;
    }
    .group {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin: 0 0 12px;
      padding: 8px 12px;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 8px;
    }
    legend {
      padding: 0 4px;
      font: var(--mat-sys-label-large);
    }
    .field {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    select {
      height: 34px;
      padding: 0 8px;
      font: inherit;
      color: inherit;
      background: transparent;
      border: 1px solid var(--mat-sys-outline);
      border-radius: 4px;
    }
    option {
      color: initial;
    }
    .note {
      margin: 4px 0;
      color: var(--mat-sys-on-surface-variant);
    }
    .warning {
      margin: 4px 0;
      padding: 8px 12px;
      color: var(--mat-sys-on-error-container);
      background: var(--mat-sys-error-container);
      border-radius: 8px;
    }
  `,
})
export class ExportDialogComponent {
  private readonly service = inject(ImportExportService);
  private readonly dialog = inject(MatDialog);
  private readonly ref = inject<MatDialogRef<ExportDialogComponent>>(MatDialogRef);

  private readonly store = inject(CollectionStore);
  protected readonly collections = computed(() => [...this.store.collections()].sort((a, b) => a.sortOrder - b.sortOrder));
  protected readonly format = signal<Format>('native');
  protected readonly selected = signal<ReadonlySet<string>>(new Set(this.collections().map((c) => c.id)));
  protected readonly postmanChoice = signal<string | null>(null);
  protected readonly postmanId = computed(() => this.postmanChoice() ?? this.collections()[0]?.id ?? '');
  protected readonly includeEnvironments = signal(true);
  protected readonly includeSecrets = signal(false);
  protected readonly error = signal<string | null>(null);

  private readonly selection = computed(() =>
    this.format() === 'postman'
      ? { collectionIds: this.postmanId() === '' ? [] : [this.postmanId()], includeEnvironments: false }
      : { collectionIds: [...this.selected()], includeEnvironments: this.includeEnvironments() },
  );
  protected readonly sensitivity = computed(() => this.service.sensitivity(this.selection()));
  protected readonly summary = computed(() => {
    const { requestsWithCredentials: requests, secretVariables: secrets } = this.sensitivity();
    const parts = [
      requests > 0 ? `${requests} request${requests === 1 ? '' : 's'} with credentials (tokens, passwords or Authorization headers)` : '',
      secrets > 0 ? `${secrets} secret environment variable${secrets === 1 ? '' : 's'}` : '',
    ].filter((part) => part !== '');
    return `This export would contain ${parts.join(' and ')}.`;
  });
  protected readonly canExport = computed(() => {
    const { collectionIds, includeEnvironments } = this.selection();
    return collectionIds.length > 0 || includeEnvironments;
  });

  protected toggle(id: string, checked: boolean): void {
    this.selected.update((set) => {
      const next = new Set(set);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  protected async run(): Promise<void> {
    this.error.set(null);
    const includeSecrets = this.includeSecrets();
    const { secretVariables, requestsWithCredentials } = this.sensitivity();
    if (includeSecrets && (secretVariables > 0 || requestsWithCredentials > 0)) {
      const data: ConfirmDialogData = {
        title: 'Export credentials in plain text?',
        message: 'The file will contain tokens, passwords and secret variable values unencrypted. Only continue if you will store and share the file safely.',
        confirmLabel: 'Export with credentials',
      };
      const confirmed = await firstValueFrom(
        this.dialog.open<ConfirmDialogComponent, ConfirmDialogData, boolean>(ConfirmDialogComponent, { data }).afterClosed(),
      );
      if (confirmed !== true) return;
    }
    let file: ExportFile;
    try {
      const selection = this.selection();
      file = this.format() === 'postman'
        ? this.service.exportPostman(selection.collectionIds[0], includeSecrets)
        : this.service.exportNative(selection, includeSecrets);
    } catch {
      this.error.set('The export could not be created. A selected collection may have been deleted.');
      return;
    }
    downloadBlob(new Blob([file.content], { type: file.mimeType }), file.filename);
    this.ref.close();
  }
}
