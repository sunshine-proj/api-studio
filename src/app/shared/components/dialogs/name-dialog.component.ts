import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButton } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';

export interface NameDialogData {
  readonly title: string;
  readonly label: string;
  readonly confirmLabel: string;
  readonly value?: string;
}

/** Asks for a single name. Closes with the trimmed text, or undefined when cancelled. */
@Component({
  selector: 'app-name-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButton, MatDialogActions, MatDialogClose, MatDialogContent, MatDialogTitle],
  template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>
    <form (submit)="submit($event, name.value)">
      <mat-dialog-content>
        <label class="field">
          {{ data.label }}
          <input
            #name
            maxlength="120"
            autocomplete="off"
            [value]="data.value ?? ''"
            [attr.aria-invalid]="invalid()"
            aria-describedby="name-error"
            (input)="invalid.set(false)"
            (focus)="name.select()"
          />
        </label>
        <p id="name-error" class="error" role="alert">{{ invalid() ? 'Enter a name.' : '' }}</p>
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" mat-dialog-close>Cancel</button>
        <button mat-flat-button type="submit">{{ data.confirmLabel }}</button>
      </mat-dialog-actions>
    </form>
  `,
  styles: `
    .field {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 320px;
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
    .error {
      min-height: 1.2em;
      margin: 4px 0 0;
      color: var(--mat-sys-error);
    }
  `,
})
export class NameDialogComponent {
  protected readonly data = inject<NameDialogData>(MAT_DIALOG_DATA);
  protected readonly invalid = signal(false);
  private readonly ref = inject<MatDialogRef<NameDialogComponent, string>>(MatDialogRef);

  protected submit(event: Event, value: string): void {
    event.preventDefault();
    const name = value.trim();
    if (name === '') {
      this.invalid.set(true);
      return;
    }
    this.ref.close(name);
  }
}
