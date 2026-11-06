import { ChangeDetectionStrategy, Component, ElementRef, inject } from '@angular/core';
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { RequestSession, SessionTab } from '@core/services/request-session.service';
import { RequestSaveFlow } from './request-save.service';

/** The row of open requests. Unsaved changes are marked with a dot and survive switching tabs. */
@Component({
  selector: 'app-request-tabs',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatMenu, MatMenuItem, MatMenuTrigger],
  template: `
    <div class="strip" role="tablist" aria-label="Open requests">
      @for (tab of session.tabs(); track tab.id) {
        <div class="tab" [class.active]="tab.id === session.activeId()">
          <button
            type="button"
            role="tab"
            [id]="'request-tab-' + tab.id"
            [attr.aria-selected]="tab.id === session.activeId()"
            [tabindex]="tab.id === session.activeId() ? 0 : -1"
            (click)="session.activate(tab.id)"
            (keydown)="navigate($event)"
            (auxclick)="closeOnMiddleClick($event, tab)"
          >
            <span class="method">{{ tab.badge() }}</span>
            <span class="title" [title]="tab.title()">{{ tab.title() }}</span>
            @if (tab.dirty()) {
              <span class="dot" aria-hidden="true">●</span>
              <span class="visually-hidden">(unsaved changes)</span>
            }
          </button>
          <button type="button" class="close" [attr.aria-label]="'Close ' + tab.title()" (click)="flow.close(tab)">×</button>
        </div>
      }
      <button type="button" class="add" aria-label="New tab" title="New tab" [matMenuTriggerFor]="newMenu">+</button>
    </div>
    <mat-menu #newMenu="matMenu">
      <button mat-menu-item type="button" (click)="session.newTab()">HTTP request</button>
      <button mat-menu-item type="button" (click)="session.newTab('websocket')">WebSocket</button>
      <button mat-menu-item type="button" (click)="session.newTab('sse')">Event stream (SSE)</button>
    </mat-menu>
    <button type="button" class="more" aria-label="Tab actions" [matMenuTriggerFor]="menu">⋯</button>
    <mat-menu #menu="matMenu">
      @if (session.activeRequest(); as request) {
        <button mat-menu-item type="button" (click)="flow.saveAs(request)">Save as…</button>
      }
      <button mat-menu-item type="button" (click)="session.duplicateTab(session.activeId())">Duplicate tab</button>
      <button mat-menu-item type="button" (click)="flow.close(session.activeTab())">Close tab</button>
    </mat-menu>
  `,
  styleUrl: './request-tabs.component.scss',
})
export class RequestTabsComponent {
  protected readonly session = inject(RequestSession);
  protected readonly flow = inject(RequestSaveFlow);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** Arrow keys, Home and End move between tabs, as in a standard tab list. */
  protected navigate(event: KeyboardEvent): void {
    const tabs = this.session.tabs();
    const index = tabs.findIndex((tab) => tab.id === this.session.activeId());
    const target = {
      ArrowRight: (index + 1) % tabs.length,
      ArrowLeft: (index - 1 + tabs.length) % tabs.length,
      Home: 0,
      End: tabs.length - 1,
    }[event.key];
    if (target === undefined) return;
    event.preventDefault();
    this.session.activate(tabs[target].id);
    queueMicrotask(() => this.host.nativeElement.querySelector<HTMLElement>(`#request-tab-${tabs[target].id}`)?.focus());
  }

  protected closeOnMiddleClick(event: MouseEvent, tab: SessionTab): void {
    if (event.button !== 1) return;
    event.preventDefault();
    void this.flow.close(tab);
  }
}
