import { ChangeDetectionStrategy, Component, computed, input, model, signal } from '@angular/core';
import { MatCheckbox } from '@angular/material/checkbox';
import { KeyValue } from '@core/models';
import { newId } from '@core/utils/id';

interface EditorRow {
  readonly item: KeyValue;
  /** True for the trailing empty row that is not part of the data yet. */
  readonly draft: boolean;
}

/**
 * Editable table of name/value rows with enable switches. A trailing empty row
 * is always shown. It keeps one id, so when the user types into it the same
 * DOM element becomes a real row and keeps keyboard focus.
 */
@Component({
  selector: 'app-key-value-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatCheckbox],
  template: `
    <div class="row head" aria-hidden="true">
      <span></span><span>{{ keyLabel() }}</span><span>{{ valueLabel() }}</span><span></span>
    </div>
    @for (row of rows(); track row.item.id) {
      <div class="row">
        @if (row.draft) {
          <span></span>
        } @else {
          <mat-checkbox
            [checked]="row.item.enabled"
            (change)="edit(row.item.id, { enabled: $event.checked })"
            [aria-label]="'Enable ' + (row.item.key || 'row')"
          />
        }
        <input
          [value]="row.item.key"
          [placeholder]="keyLabel()"
          [attr.aria-label]="row.draft ? 'New ' + keyLabel() : keyLabel()"
          (input)="edit(row.item.id, { key: $any($event.target).value })"
        />
        <input
          [value]="row.item.value"
          [placeholder]="valueLabel()"
          [attr.aria-label]="row.draft ? 'New ' + valueLabel() : valueLabel()"
          (input)="edit(row.item.id, { value: $any($event.target).value })"
        />
        @if (row.draft) {
          <span></span>
        } @else {
          <button type="button" class="remove" (click)="remove(row.item.id)" [attr.aria-label]="'Remove ' + (row.item.key || 'row')">
            ×
          </button>
        }
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
      padding: 8px 12px;
      overflow: auto;
    }
    .row {
      display: grid;
      grid-template-columns: 40px 1fr 1fr 32px;
      align-items: center;
      gap: 6px;
      margin-bottom: 4px;
    }
    .head {
      font: var(--mat-sys-label-small);
      color: var(--mat-sys-on-surface-variant);
    }
    input {
      min-width: 0;
      height: 28px;
      padding: 0 8px;
      box-sizing: border-box;
      font: inherit;
      color: inherit;
      background: transparent;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 4px;
    }
    input:focus {
      outline: 2px solid var(--mat-sys-primary);
      outline-offset: -1px;
    }
    .remove {
      width: 28px;
      height: 28px;
      font-size: 18px;
      line-height: 1;
      color: var(--mat-sys-on-surface-variant);
      background: transparent;
      border: 0;
      border-radius: 4px;
      cursor: pointer;
    }
    .remove:hover,
    .remove:focus-visible {
      background: var(--mat-sys-surface-container-highest);
    }
  `,
})
export class KeyValueEditorComponent {
  /** Two-way: writes are visible to reads immediately, even before the parent re-renders. */
  readonly items = model.required<readonly KeyValue[]>();
  readonly keyLabel = input('Key');
  readonly valueLabel = input('Value');

  private readonly draftId = signal(newId());
  protected readonly rows = computed<readonly EditorRow[]>(() => [
    ...this.items().map((item): EditorRow => ({ item, draft: false })),
    { item: { id: this.draftId(), key: '', value: '', enabled: true }, draft: true },
  ]);

  /** Applies changes to a row by id. The id of the empty row creates a new item. */
  protected edit(id: string, changes: Partial<KeyValue>): void {
    const current = this.items();
    if (current.some((item) => item.id === id)) {
      this.items.set(current.map((item) => (item.id === id ? { ...item, ...changes } : item)));
    } else if (id === this.draftId()) {
      this.items.set([...current, { id, key: '', value: '', enabled: true, ...changes }]);
      this.draftId.set(newId());
    }
  }

  protected remove(id: string): void {
    this.items.set(this.items().filter((item) => item.id !== id));
  }
}
