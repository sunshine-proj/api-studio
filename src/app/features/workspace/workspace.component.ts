import { ChangeDetectionStrategy, Component } from '@angular/core';
import { SplitPaneComponent } from '@shared/components/split-pane/split-pane.component';
import { CollectionsSidebarComponent } from '../collections/collections-sidebar.component';
import { EnvironmentSelectorComponent } from '../environments/environment-selector.component';
import { RequestEditorComponent } from '../request-editor/request-editor.component';
import { ResponseViewerComponent } from '../response-viewer/response-viewer.component';

/** Application shell: header, collections sidebar, request editor and response panel. */
@Component({
  selector: 'app-workspace',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CollectionsSidebarComponent, EnvironmentSelectorComponent, RequestEditorComponent, ResponseViewerComponent, SplitPaneComponent],
  template: `
    <header>
      <h1>API Studio</h1>
      <app-environment-selector />
    </header>
    <app-split-pane class="main" [initialPercent]="18" [minPx]="180" label="Resize sidebar">
      <app-collections-sidebar first />
      <app-split-pane
        second
        direction="vertical"
        [initialPercent]="50"
        [minPx]="140"
        label="Resize request and response panels"
      >
        <main first aria-label="Request"><app-request-editor /></main>
        <section second aria-label="Response"><app-response-viewer /></section>
      </app-split-pane>
    </app-split-pane>
  `,
  styleUrl: './workspace.component.scss',
})
export class WorkspaceComponent {}
