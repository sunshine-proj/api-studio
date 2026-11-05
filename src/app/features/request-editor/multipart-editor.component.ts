import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatCheckbox } from '@angular/material/checkbox';
import { FormDataField } from '@core/models';
import { RequestSession } from '@core/services/request-session.service';
import { formatBytes } from '@core/utils/response.util';

/** Editor for multipart/form-data: text fields and files, in order, with repeatable names. */
@Component({
  selector: 'app-multipart-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatCheckbox],
  template: `
    @for (field of fields(); track field.id) {
      <div class="row">
        <mat-checkbox
          [checked]="field.enabled"
          (change)="session.updateMultipartField(field.id, { enabled: $event.checked })"
          [aria-label]="'Enable ' + (field.key || 'field')"
        />
        <input
          placeholder="Field name"
          aria-label="Field name"
          [value]="field.key"
          (input)="session.updateMultipartField(field.id, { key: $any($event.target).value })"
        />
        <select
          aria-label="Field type"
          (change)="session.updateMultipartField(field.id, { kind: $any($event.target).value })"
        >
          <option value="text" [selected]="field.kind === 'text'">Text</option>
          <option value="file" [selected]="field.kind === 'file'">File</option>
        </select>

        @if (field.kind === 'text') {
          <input
            placeholder="Value"
            aria-label="Field value"
            [value]="field.value"
            (input)="session.updateMultipartField(field.id, { value: $any($event.target).value })"
          />
        } @else {
          <div class="file">
            <button type="button" class="choose" (click)="picker.click()">
              {{ field.file ? 'Change file' : 'Choose file' }}
            </button>
            <input #picker type="file" hidden (change)="choose(field.id, $any($event.target))" />
            @if (field.file; as file) {
              <span class="meta" [title]="file.name">
                {{ file.name }} <span class="size">({{ size(file.size) }}{{ file.mimeType ? ', ' + file.mimeType : '' }})</span>
              </span>
            } @else {
              <span class="meta empty">No file selected</span>
            }
          </div>
        }

        <button type="button" class="remove" (click)="session.removeMultipartField(field.id)" aria-label="Remove field">×</button>
      </div>
    }

    <div class="actions">
      <button type="button" (click)="session.addMultipartText()">Add text field</button>
      <button type="button" (click)="files.click()">Add files…</button>
      <input #files type="file" multiple hidden (change)="addFiles($any($event.target))" />
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .row {
      display: grid;
      grid-template-columns: 40px 1fr 80px 2fr 32px;
      align-items: center;
      gap: 6px;
      margin-bottom: 4px;
    }
    input:not([type='file']),
    select,
    .choose,
    .actions button {
      height: 28px;
      padding: 0 8px;
      font: inherit;
      color: inherit;
      background: transparent;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 4px;
    }
    input:focus,
    select:focus,
    button:focus-visible {
      outline: 2px solid var(--mat-sys-primary);
      outline-offset: -1px;
    }
    .file {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }
    .choose,
    .actions button {
      cursor: pointer;
    }
    .meta {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .size,
    .empty {
      color: var(--mat-sys-on-surface-variant);
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
    .actions {
      display: flex;
      gap: 8px;
      margin-top: 8px;
    }
  `,
})
export class MultipartEditorComponent {
  protected readonly session = inject(RequestSession);
  protected readonly fields = computed<readonly FormDataField[]>(() => {
    const body = this.session.draft().body;
    return body.type === 'multipart' ? body.fields : [];
  });
  protected readonly size = formatBytes;

  protected choose(id: string, input: HTMLInputElement): void {
    const file = input.files?.item(0);
    if (file) this.session.attachMultipartFile(id, file);
    input.value = '';
  }

  protected addFiles(input: HTMLInputElement): void {
    this.session.addMultipartFiles(Array.from(input.files ?? []));
    input.value = '';
  }
}
