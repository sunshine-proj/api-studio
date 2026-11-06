import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { MatButtonToggle, MatButtonToggleGroup } from '@angular/material/button-toggle';
import { CollectionsSidebarComponent } from '../collections/collections-sidebar.component';
import { HistoryPanelComponent } from '../history/history-panel.component';

/** The left panel: saved collections or request history. */
@Component({
  selector: 'app-sidebar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CollectionsSidebarComponent, HistoryPanelComponent, MatButtonToggle, MatButtonToggleGroup],
  template: `
    <mat-button-toggle-group
      class="switch"
      aria-label="Sidebar view"
      hideSingleSelectionIndicator
      [value]="view()"
      (change)="view.set($event.value)"
    >
      <mat-button-toggle value="collections">Collections</mat-button-toggle>
      <mat-button-toggle value="history">History</mat-button-toggle>
    </mat-button-toggle-group>
    <div class="content">
      @if (view() === 'collections') {
        <app-collections-sidebar />
      } @else {
        <app-history-panel />
      }
    </div>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      background: var(--mat-sys-surface-container-low);
    }
    .switch {
      margin: 8px 8px 0;
    }
    .content {
      flex: 1 1 auto;
      min-height: 0;
      overflow: auto;
    }
  `,
})
export class SidebarComponent {
  protected readonly view = signal<'collections' | 'history'>('collections');
}
