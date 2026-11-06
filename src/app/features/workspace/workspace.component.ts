import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RequestSession } from '@core/services/request-session.service';
import { SplitPaneComponent } from '@shared/components/split-pane/split-pane.component';
import { CollectionsSidebarComponent } from '../collections/collections-sidebar.component';
import { EnvironmentSelectorComponent } from '../environments/environment-selector.component';
import { RequestEditorComponent } from '../request-editor/request-editor.component';
import { RequestTabsComponent } from '../request-editor/request-tabs.component';
import { ResponseViewerComponent } from '../response-viewer/response-viewer.component';
import { StorageNoticeComponent } from './storage-notice.component';
import { ThemeSelectorComponent } from './theme-selector.component';

/** Application shell: header, collections sidebar, request editor and response panel. */
@Component({
  selector: 'app-workspace',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CollectionsSidebarComponent,
    EnvironmentSelectorComponent,
    RequestEditorComponent,
    RequestTabsComponent,
    ResponseViewerComponent,
    SplitPaneComponent,
    StorageNoticeComponent,
    ThemeSelectorComponent,
  ],
  host: { '(window:beforeunload)': 'warnAboutUnsavedChanges($event)' },
  template: `
    <header>
      <h1>API Studio</h1>
      <div class="controls">
        <app-environment-selector />
        <app-theme-selector />
      </div>
    </header>
    <app-storage-notice />
    <app-split-pane class="main" [initialPercent]="18" [minPx]="180" label="Resize sidebar">
      <app-collections-sidebar first />
      <app-split-pane
        second
        direction="vertical"
        [initialPercent]="50"
        [minPx]="140"
        label="Resize request and response panels"
      >
        <main first aria-label="Request">
          <app-request-tabs />
          <app-request-editor />
        </main>
        <section second aria-label="Response"><app-response-viewer /></section>
      </app-split-pane>
    </app-split-pane>
  `,
  styleUrl: './workspace.component.scss',
})
export class WorkspaceComponent {
  private readonly session = inject(RequestSession);

  /** Unsaved tabs live only in memory, so leaving the page would lose them. */
  protected warnAboutUnsavedChanges(event: BeforeUnloadEvent): void {
    if (this.session.hasUnsavedChanges()) event.preventDefault();
  }
}
