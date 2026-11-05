import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import type * as Monaco from 'monaco-editor';
import { loadMonaco } from './monaco-loader';

export type EditorLanguage = 'json' | 'xml' | 'html' | 'plaintext' | 'javascript';

/** Monaco wrapper. Monaco is fetched lazily the first time an editor is shown. */
@Component({
  selector: 'app-code-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div #host class="host" [attr.aria-label]="label()"></div>
    @if (status() === 'loading') {
      <p class="overlay" role="status">Loading editor…</p>
    } @else if (status() === 'failed') {
      <p class="overlay error" role="alert">The code editor could not be loaded.</p>
    }
  `,
  styles: `
    :host {
      display: block;
      position: relative;
      min-height: 120px;
      height: 100%;
    }
    .host {
      position: absolute;
      inset: 0;
    }
    .overlay {
      position: absolute;
      inset: 0;
      margin: 0;
      padding: 12px;
      color: var(--mat-sys-on-surface-variant);
    }
    .error {
      color: var(--mat-sys-error);
    }
  `,
})
export class CodeEditorComponent {
  readonly value = input('');
  readonly language = input<EditorLanguage>('plaintext');
  readonly readOnly = input(false);
  readonly label = input('Code editor');
  readonly valueChange = output<string>();

  protected readonly status = signal<'loading' | 'ready' | 'failed'>('loading');
  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');
  private editor: Monaco.editor.IStandaloneCodeEditor | undefined;
  private monacoApi: typeof Monaco | undefined;
  private destroyed = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.editor?.getModel()?.dispose();
      this.editor?.dispose();
    });

    loadMonaco().then(
      (monaco) => {
        if (this.destroyed) return;
        this.monacoApi = monaco;
        this.editor = monaco.editor.create(this.host().nativeElement, {
          value: this.value(),
          language: this.language(),
          readOnly: this.readOnly(),
          ariaLabel: this.label(),
          theme: window.matchMedia('(prefers-color-scheme: dark)').matches ? 'vs-dark' : 'vs',
          automaticLayout: true,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          fontSize: 13,
          tabSize: 2,
        });
        this.editor.onDidChangeModelContent(() => this.valueChange.emit(this.editor?.getValue() ?? ''));
        this.status.set('ready');
      },
      () => this.status.set('failed'),
    );

    // Push external input changes into the editor without echoing them back.
    effect(() => {
      const value = this.value();
      const language = this.language();
      const readOnly = this.readOnly();
      if (!this.editor || !this.monacoApi) return;
      this.editor.updateOptions({ readOnly });
      const model = this.editor.getModel();
      if (model) {
        this.monacoApi.editor.setModelLanguage(model, language);
        if (model.getValue() !== value) {
          this.editor.setValue(value);
        }
      }
    });
  }
}
