import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, resource, signal } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatButtonToggle, MatButtonToggleGroup } from '@angular/material/button-toggle';
import { MatProgressBar } from '@angular/material/progress-bar';
import { MatTab, MatTabGroup } from '@angular/material/tabs';
import { ExecutionFailure, ExecutionSuccess } from '@core/models';
import { RequestSession } from '@core/services/request-session.service';
import { SettingsStore } from '@core/services/settings-store.service';
import { downloadBlob, suggestFilename } from '@core/utils/download';
import { parseJson } from '@core/utils/json-tree.util';
import {
  ResponseView,
  availableViews,
  decodeBody,
  detectBodyKind,
  formatBytes,
  formatDuration,
  prettyPrintJson,
  statusDescription,
} from '@core/utils/response.util';
import { CodeEditorComponent, EditorLanguage } from '@shared/components/code-editor/code-editor.component';
import { HtmlPreviewComponent } from '@shared/components/html-preview/html-preview.component';
import { ImagePreviewComponent } from '@shared/components/image-preview/image-preview.component';
import { JsonTreeComponent } from '@shared/components/json-tree/json-tree.component';

interface DecodedBody {
  readonly raw: string;
  /** Formatted text when the body is JSON, otherwise null. */
  readonly pretty: string | null;
}

@Component({
  selector: 'app-response-viewer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButton,
    MatButtonToggle,
    MatButtonToggleGroup,
    MatProgressBar,
    MatTab,
    MatTabGroup,
    CodeEditorComponent,
    HtmlPreviewComponent,
    ImagePreviewComponent,
    JsonTreeComponent,
    NgTemplateOutlet,
  ],
  templateUrl: './response-viewer.component.html',
  styleUrl: './response-viewer.component.scss',
})
export class ResponseViewerComponent {
  private readonly session = inject(RequestSession);
  private readonly settings = inject(SettingsStore);

  protected readonly state = this.session.state;
  protected readonly success = computed<ExecutionSuccess | null>(() => {
    const state = this.state();
    return state.status === 'done' && state.result.ok ? state.result : null;
  });
  protected readonly failure = computed<ExecutionFailure | null>(() => {
    const state = this.state();
    return state.status === 'done' && !state.result.ok ? state.result : null;
  });
  protected readonly report = computed(() => {
    const state = this.state();
    return state.status === 'done' ? state.report : null;
  });
  protected readonly checkTotals = computed(() => {
    const checks = this.report()?.checks ?? [];
    return { total: checks.length, passed: checks.filter((c) => c.passed).length };
  });
  protected readonly testsLabel = computed(() => {
    const { total, passed } = this.checkTotals();
    return total === 0 ? 'Tests' : `Tests (${passed}/${total})`;
  });
  protected readonly warnings = computed(() => {
    const state = this.state();
    return state.status === 'done' ? state.result.warnings : [];
  });

  protected readonly kind = computed(() => detectBodyKind(this.success()?.response.body.contentType ?? null));
  /** Largest body shown in the viewer (a setting). Bigger ones can only be downloaded. */
  protected readonly renderLimit = computed(() => this.settings.settings().maxRenderedResponseBytes);
  protected readonly tooLarge = computed(() => (this.success()?.response.body.size ?? 0) > this.renderLimit());
  protected readonly isTextual = computed(() => ['json', 'xml', 'html', 'text'].includes(this.kind()));
  protected readonly views = computed(() => availableViews(this.kind()));
  private readonly view = signal<ResponseView | null>(null);
  /** The chosen view if this kind of body offers it, otherwise the kind's default. */
  protected readonly activeView = computed<ResponseView>(() => {
    const views = this.views();
    const chosen = this.view();
    return views.find((v) => v.id === chosen)?.id ?? views[0]?.id ?? 'pretty';
  });

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
    return this.activeView() !== 'raw' && decoded.pretty !== null ? decoded.pretty : decoded.raw;
  });

  /** Parsed JSON for the tree view, parsed only while that view is showing. */
  protected readonly tree = computed(() => {
    const decoded = this.decoded.value();
    return this.activeView() === 'tree' && decoded ? parseJson(decoded.raw) : null;
  });

  protected readonly language = computed<EditorLanguage>(() => {
    const kind = this.kind();
    return this.activeView() === 'raw' || kind === 'text' ? 'plaintext' : (kind as EditorLanguage);
  });

  protected selectView(view: ResponseView): void {
    this.view.set(view);
  }

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
    const { headers, body, url } = success.response;
    const disposition = headers.find((h) => h.name.toLowerCase() === 'content-disposition');
    downloadBlob(success.body, suggestFilename(disposition?.value ?? null, url, body.contentType));
  }
}
