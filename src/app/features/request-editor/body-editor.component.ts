import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { BodyKind, RequestSession } from '@core/services/request-session.service';
import { formatBytes } from '@core/utils/response.util';
import { CodeEditorComponent, EditorLanguage } from '@shared/components/code-editor/code-editor.component';
import { KeyValueEditorComponent } from '@shared/components/key-value-editor/key-value-editor.component';
import { MultipartEditorComponent } from './multipart-editor.component';

const BODY_KINDS: readonly { readonly kind: BodyKind; readonly label: string }[] = [
  { kind: 'none', label: 'None' },
  { kind: 'json', label: 'JSON' },
  { kind: 'xml', label: 'XML' },
  { kind: 'text', label: 'Text' },
  { kind: 'javascript', label: 'JavaScript' },
  { kind: 'urlencoded', label: 'Form URL Encoded' },
  { kind: 'multipart', label: 'Multipart Form Data' },
  { kind: 'binary', label: 'Binary' },
];

const EDITOR_LANGUAGES: Readonly<Record<string, EditorLanguage>> = {
  json: 'json',
  xml: 'xml',
  text: 'plaintext',
  javascript: 'javascript',
};

@Component({
  selector: 'app-body-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CodeEditorComponent, KeyValueEditorComponent, MultipartEditorComponent],
  template: `
    <div class="kinds" role="radiogroup" aria-label="Body type">
      @for (option of kinds; track option.kind) {
        <label>
          <input type="radio" name="body-kind" [value]="option.kind" [checked]="kind() === option.kind" (change)="session.setBodyKind(option.kind)" />
          {{ option.label }}
        </label>
      }
    </div>

    <div class="content">
      @switch (body().type) {
        @case ('none') {
          <p class="hint">This request has no body.</p>
        }
        @case ('text') {
          <div class="editor">
            <app-code-editor
              [label]="'Request body (' + kind() + ')'"
              [language]="language()"
              [value]="text()"
              (valueChange)="session.setBodyText($event)"
            />
          </div>
        }
        @case ('urlencoded') {
          <app-key-value-editor keyLabel="Field" [items]="urlencodedFields()" (itemsChange)="session.setUrlencoded($event)" />
        }
        @case ('multipart') {
          <div class="padded"><app-multipart-editor /></div>
        }
        @case ('binary') {
          <div class="padded binary">
            <button type="button" (click)="picker.click()">{{ binaryFile() ? 'Change file' : 'Choose file' }}</button>
            <input #picker type="file" hidden (change)="chooseBinary($any($event.target))" />
            @if (binaryFile(); as file) {
              <span>{{ file.name }} ({{ size(file.size) }}{{ file.mimeType ? ', ' + file.mimeType : '' }})</span>
              <button type="button" (click)="session.setBinaryFile(null)">Remove</button>
            } @else {
              <span class="hint">No file selected. The file is sent as the raw request body.</span>
            }
          </div>
        }
      }
    </div>

    @if (body().type === 'multipart') {
      <p class="hint padded">
        The browser sets the Content-Type header with the multipart boundary. Large files are streamed from disk when sent.
      </p>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 240px;
      box-sizing: border-box;
    }
    .kinds {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 16px;
      padding: 8px 12px;
    }
    .content {
      flex: 1 1 auto;
      min-height: 0;
      overflow: auto;
    }
    .editor {
      height: 100%;
      min-height: 200px;
      margin: 0 12px 12px;
      border: 1px solid var(--mat-sys-outline-variant);
    }
    .padded {
      padding: 8px 12px;
    }
    .binary {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .binary button {
      height: 28px;
      padding: 0 12px;
      font: inherit;
      color: inherit;
      background: transparent;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 4px;
      cursor: pointer;
    }
    .hint {
      margin: 8px 12px;
      color: var(--mat-sys-on-surface-variant);
    }
  `,
})
export class BodyEditorComponent {
  protected readonly session = inject(RequestSession);
  protected readonly kinds = BODY_KINDS;
  protected readonly size = formatBytes;

  protected readonly body = computed(() => this.session.draft().body);
  protected readonly kind = computed<BodyKind>(() => {
    const body = this.body();
    return body.type === 'text' ? body.language : body.type;
  });
  protected readonly language = computed<EditorLanguage>(() => EDITOR_LANGUAGES[this.kind()] ?? 'plaintext');
  protected readonly text = computed(() => {
    const body = this.body();
    return body.type === 'text' ? body.content : '';
  });
  protected readonly urlencodedFields = computed(() => {
    const body = this.body();
    return body.type === 'urlencoded' ? body.fields : [];
  });
  protected readonly binaryFile = computed(() => {
    const body = this.body();
    return body.type === 'binary' ? body.file : undefined;
  });

  protected chooseBinary(input: HTMLInputElement): void {
    this.session.setBinaryFile(input.files?.item(0) ?? null);
    input.value = '';
  }
}
