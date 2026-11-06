import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, effect, inject, viewChild } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { RequestSession } from '@core/services/request-session.service';
import { formatBytes } from '@core/utils/response.util';

const ARROWS = { in: '↓', out: '↑', info: 'ℹ', error: '⚠' } as const;
const DIRECTION_LABELS = { in: 'Received', out: 'Sent', info: 'Info', error: 'Error' } as const;

/** The message log of the active WebSocket or event stream. */
@Component({
  selector: 'app-realtime-log',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, MatButton],
  template: `
    @if (tab(); as t) {
      <div class="head">
        <h2>Messages ({{ t.messages().length }})</h2>
        <button mat-button type="button" [disabled]="t.messages().length === 0" (click)="t.clear()">Clear</button>
      </div>
      <div #scroller class="scroller" role="log" aria-label="Message log" tabindex="0">
        @if (t.messages().length === 0) {
          <p class="empty">No messages yet. Connect to start.</p>
        }
        @for (message of t.messages(); track message.id) {
          <article [class]="'message ' + message.direction">
            <header>
              <span class="arrow" aria-hidden="true">{{ arrows[message.direction] }}</span>
              <span class="visually-hidden">{{ directions[message.direction] }}</span>
              <time>{{ message.at | date: 'HH:mm:ss.SSS' }}</time>
              @if (message.event && message.event !== 'message') {
                <span class="event">{{ message.event }}</span>
              }
              @if (message.direction === 'in' || message.direction === 'out') {
                <span class="size">{{ size(message.size) }}</span>
              }
            </header>
            <pre>{{ message.text }}</pre>
            @if (message.truncated) {
              <p class="cut">Shortened for display. The message was {{ size(message.size) }}.</p>
            }
          </article>
        }
      </div>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
    }
    .head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 4px 12px;
      h2 {
        margin: 0;
        font: var(--mat-sys-title-small);
      }
    }
    .scroller {
      flex: 1 1 auto;
      min-height: 0;
      padding: 0 12px 12px;
      overflow: auto;
    }
    .empty {
      color: var(--mat-sys-on-surface-variant);
    }
    .message {
      margin-bottom: 6px;
      padding: 4px 8px;
      border-left: 3px solid var(--mat-sys-outline-variant);
      background: var(--mat-sys-surface-container-low);
      border-radius: 0 4px 4px 0;
    }
    .message.in {
      border-left-color: #1565c0;
    }
    .message.out {
      border-left-color: #2e7d32;
    }
    .message.error {
      border-left-color: var(--mat-sys-error);
    }
    .message.info {
      color: var(--mat-sys-on-surface-variant);
    }
    header {
      display: flex;
      gap: 8px;
      align-items: baseline;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-label-small);
    }
    .event {
      padding: 0 6px;
      border-radius: 8px;
      background: var(--mat-sys-secondary-container);
      color: var(--mat-sys-on-secondary-container);
    }
    pre {
      margin: 2px 0 0;
      font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .cut {
      margin: 2px 0 0;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    .visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
    }
  `,
})
export class RealtimeLogComponent {
  private readonly session = inject(RequestSession);
  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');

  protected readonly tab = this.session.activeRealtime;
  protected readonly arrows = ARROWS;
  protected readonly directions = DIRECTION_LABELS;
  protected readonly size = formatBytes;

  constructor() {
    // Follow new messages, but only while the user is already at the bottom, so reading older ones is not interrupted.
    effect(() => {
      this.tab()?.messages();
      const element = this.scroller()?.nativeElement;
      if (!element) return;
      const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 40;
      if (atBottom) queueMicrotask(() => (element.scrollTop = element.scrollHeight));
    });
  }
}
