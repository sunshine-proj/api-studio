import { ChangeDetectionStrategy, Component, computed, inject, resource, signal } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatButtonToggle, MatButtonToggleGroup } from '@angular/material/button-toggle';
import { MatProgressBar } from '@angular/material/progress-bar';
import { MatTab, MatTabGroup } from '@angular/material/tabs';
import { ExecutionFailure, ExecutionSuccess } from '@core/models';
import { RequestSession } from '@core/services/request-session.service';
import { downloadBlob, filenameFromDisposition } from '@core/utils/download';
import {
  MAX_RENDERED_BYTES,
  decodeBody,
  detectBodyKind,
  formatBytes,
  formatDuration,
  prettyPrintJson,
  statusDescription,
} from '@core/utils/response.util';
import { CodeEditorComponent, EditorLanguage } from '@shared/components/code-editor/code-editor.component';

interface DecodedBody {
  readonly raw: string;
  /** Formatted text when the body is JSON, otherwise null. */
  readonly pretty: string | null;
}

@Component({
  selector: 'app-response-viewer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButton, MatButtonToggle, MatButtonToggleGroup, MatProgressBar, MatTab, MatTabGroup, CodeEditorComponent],
  templateUrl: './response-viewer.component.html',
  styleUrl: './response-viewer.component.scss',
})
export class ResponseViewerComponent {
  private readonly session = inject(RequestSession);

  protected readonly state = this.session.state;
  protected readonly success = computed<ExecutionSuccess | null>(() => {
    const state = this.state();
    return state.status === 'done' && state.result.ok ? state.result : null;
  });
  protected readonly failure = computed<ExecutionFailure | null>(() => {
    const state = this.state();
    return state.status === 'done' && !state.result.ok ? state.result : null;
  });
  protected readonly warnings = computed(() => {
    const state = this.state();
    return state.status === 'done' ? state.result.warnings : [];
  });

  protected readonly kind = computed(() => detectBodyKind(this.success()?.response.body.contentType ?? null));
  protected readonly tooLarge = computed(() => (this.success()?.response.body.size ?? 0) > MAX_RENDERED_BYTES);
  protected readonly isTextual = computed(() => ['json', 'xml', 'html', 'text'].includes(this.kind()));
  protected readonly view = signal<'pretty' | 'raw'>('pretty');

  protected readonly decoded = resource<DecodedBody | undefined, ExecutionSuccess | undefined>({
    params: () => {
      const success = this.success();
      return success && this.isTextual() && !this.tooLarge() ? success : undefined;
    },
    loader: async ({ params }): Promise<DecodedBody> => {
      const raw = await decodeBody(params.body, params.response.body.contentType);
      return { raw, pretty: this.kind() === 'json' ? prettyPrintJson(raw) : null };
    },
  });

  protected readonly shownText = computed(() => {
    const decoded = this.decoded.value();
    if (!decoded) return '';
    return this.view() === 'pretty' && decoded.pretty !== null ? decoded.pretty : decoded.raw;
  });

  protected readonly language = computed<EditorLanguage>(() => {
    const kind = this.kind();
    return this.view() === 'raw' || kind === 'text' ? 'plaintext' : (kind as EditorLanguage);
  });

  protected readonly statusClass = computed(() => {
    const status = this.success()?.response.status ?? 0;
    if (status >= 500) return 'server-error';
    if (status >= 400) return 'client-error';
    if (status >= 300) return 'redirect';
    return status >= 200 ? 'ok' : 'unknown';
  });

  protected readonly format = { bytes: formatBytes, duration: formatDuration, status: statusDescription };

  protected download(): void {
    const success = this.success();
    if (!success) return;
    const disposition = success.response.headers.find((h) => h.name.toLowerCase() === 'content-disposition');
    downloadBlob(success.body, filenameFromDisposition(disposition?.value ?? null) ?? 'response');
  }
}
