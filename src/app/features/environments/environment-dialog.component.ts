import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatCheckbox } from '@angular/material/checkbox';
import { MatDialogActions, MatDialogClose, MatDialogContent, MatDialogTitle } from '@angular/material/dialog';
import { EnvironmentVariable } from '@core/models';
import { EnvironmentStore } from '@core/services/environment-store.service';
import { newId } from '@core/utils/id';

/** Create environments and edit their variables. Variables are referenced as {{name}}. */
@Component({
  selector: 'app-environment-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButton, MatCheckbox, MatDialogActions, MatDialogClose, MatDialogContent, MatDialogTitle],
  template: `
    <h2 mat-dialog-title>Environments</h2>
    <mat-dialog-content>
      <div class="picker">
        <label for="env-select">Environment</label>
        <select id="env-select" [value]="selectedId() ?? ''" (change)="selectedId.set($any($event.target).value || null)">
          @for (env of store.environments(); track env.id) {
            <option [value]="env.id" [selected]="env.id === selectedId()">{{ env.name }}</option>
          }
        </select>
        <button mat-stroked-button type="button" (click)="create()">New</button>
        @if (selected(); as env) {
          <button mat-stroked-button type="button" (click)="remove(env.id)">Delete</button>
        }
      </div>

      @if (store.error(); as message) {
        <p class="note" role="alert">{{ message }}</p>
      }

      @if (selected(); as env) {
        <label class="field">
          Name
          <input [value]="env.name" (change)="store.rename(env.id, $any($event.target).value)" />
        </label>

        <p class="note">
          Reference variables as <code ngNonBindable>{{name}}</code> in the URL, headers and body. Data is
          stored unencrypted in this browser. Do not keep production secrets here.
        </p>

        @for (variable of env.variables; track variable.id) {
          <div class="row">
            <mat-checkbox
              [checked]="variable.enabled"
              (change)="update(variable, { enabled: $event.checked })"
              [aria-label]="'Enable ' + (variable.name || 'variable')"
            />
            <input
              placeholder="Name"
              aria-label="Variable name"
              [value]="variable.name"
              (input)="update(variable, { name: $any($event.target).value })"
            />
            <input
              placeholder="Value"
              aria-label="Variable value"
              [type]="variable.secret ? 'password' : 'text'"
              autocomplete="off"
              [value]="variable.value"
              (input)="update(variable, { value: $any($event.target).value })"
            />
            <mat-checkbox [checked]="variable.secret" (change)="update(variable, { secret: $event.checked })">
              Secret
            </mat-checkbox>
            <button type="button" class="remove" (click)="removeVariable(variable)" aria-label="Remove variable">×</button>
          </div>
        }
        <button mat-button type="button" (click)="addVariable()">Add variable</button>
      } @else {
        <p class="note">No environments yet. Create one to define variables.</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-flat-button mat-dialog-close>Done</button>
    </mat-dialog-actions>
  `,
  styles: `
    mat-dialog-content {
      min-width: 560px;
    }
    .picker,
    .row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }
    .field {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin-bottom: 8px;
    }
    input,
    select {
      height: 30px;
      padding: 0 8px;
      font: inherit;
      color: inherit;
      background: transparent;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 4px;
    }
    .row input {
      flex: 1 1 0;
      min-width: 0;
    }
    .note {
      color: var(--mat-sys-on-surface-variant);
    }
    .remove {
      width: 28px;
      height: 28px;
      font-size: 18px;
      color: var(--mat-sys-on-surface-variant);
      background: transparent;
      border: 0;
      cursor: pointer;
    }
  `,
})
export class EnvironmentDialogComponent {
  protected readonly store = inject(EnvironmentStore);
  protected readonly selectedId = signal<string | null>(this.store.activeId() ?? this.store.environments()[0]?.id ?? null);
  protected readonly selected = computed(() => this.store.environments().find((e) => e.id === this.selectedId()) ?? null);

  protected async create(): Promise<void> {
    const environment = await this.store.create(`Environment ${this.store.environments().length + 1}`);
    if (environment) this.selectedId.set(environment.id);
  }

  protected async remove(id: string): Promise<void> {
    await this.store.remove(id);
    this.selectedId.set(this.store.environments()[0]?.id ?? null);
  }

  protected addVariable(): void {
    const env = this.selected();
    if (!env) return;
    const variable: EnvironmentVariable = { id: newId(), name: '', value: '', enabled: true, secret: false };
    this.store.setVariables(env.id, [...env.variables, variable]);
  }

  protected update(variable: EnvironmentVariable, changes: Partial<EnvironmentVariable>): void {
    const env = this.selected();
    if (!env) return;
    this.store.setVariables(
      env.id,
      env.variables.map((v) => (v.id === variable.id ? { ...v, ...changes } : v)),
    );
  }

  protected removeVariable(variable: EnvironmentVariable): void {
    const env = this.selected();
    if (!env) return;
    this.store.setVariables(env.id, env.variables.filter((v) => v.id !== variable.id));
  }
}
