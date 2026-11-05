import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { EnvironmentStore } from '@core/services/environment-store.service';
import { EnvironmentDialogComponent } from './environment-dialog.component';

@Component({
  selector: 'app-environment-selector',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButton],
  template: `
    <label for="active-environment">Environment</label>
    <select
      id="active-environment"
      (change)="store.setActive($any($event.target).value || null)"
    >
      <option value="" [selected]="store.activeId() === null">No environment</option>
      @for (env of store.environments(); track env.id) {
        <option [value]="env.id" [selected]="env.id === store.activeId()">{{ env.name }}</option>
      }
    </select>
    <button mat-stroked-button type="button" (click)="manage()">Manage</button>
  `,
  styles: `
    :host {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    select {
      height: 32px;
      padding: 0 8px;
      font: inherit;
      color: inherit;
      background: var(--mat-sys-surface);
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 4px;
    }
  `,
})
export class EnvironmentSelectorComponent {
  protected readonly store = inject(EnvironmentStore);
  private readonly dialog = inject(MatDialog);

  protected manage(): void {
    this.dialog.open(EnvironmentDialogComponent, { autoFocus: 'dialog' });
  }
}
