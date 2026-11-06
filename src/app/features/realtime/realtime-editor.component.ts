import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { RequestSession } from '@core/services/request-session.service';
import { KeyValueEditorComponent } from '@shared/components/key-value-editor/key-value-editor.component';

const STATUS_LABELS = {
  idle: 'Not connected',
  connecting: 'Connecting…',
  open: 'Connected',
  closed: 'Disconnected',
  error: 'Failed',
} as const;

/** URL, connection controls and (for WebSockets) the message to send. The log is shown in the lower panel. */
@Component({
  selector: 'app-realtime-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButton, KeyValueEditorComponent],
  host: { '(keydown.control.enter)': 'send()', '(keydown.meta.enter)': 'send()' },
  template: `
    @if (tab(); as t) {
      <form class="bar" (submit)="$event.preventDefault(); toggle()">
        <label class="url">
          <span class="visually-hidden">{{ websocket() ? 'WebSocket URL' : 'Event stream URL' }}</span>
          <input
            type="text"
            inputmode="url"
            autocomplete="off"
            spellcheck="false"
            [placeholder]="websocket() ? 'wss://echo.example.com/socket  or  wss://{{host}}/ws' : 'https://api.example.com/events'"
            [value]="t.url()"
            [disabled]="t.busy()"
            (input)="t.url.set($any($event.target).value)"
          />
        </label>
        @if (t.busy()) {
          <button mat-stroked-button type="button" (click)="t.disconnect()">Disconnect</button>
        } @else {
          <button mat-flat-button type="submit">Connect</button>
        }
        <span class="status" [class]="'status ' + t.status()" role="status">{{ labels[t.status()] }}</span>
      </form>

      @if (websocket()) {
        <label class="field">
          Subprotocols (optional, comma separated)
          <input autocomplete="off" [value]="t.protocols()" [disabled]="t.busy()" (input)="t.protocols.set($any($event.target).value)" />
        </label>
        <p class="note">
          Browsers do not let a page set headers or cookies on a WebSocket handshake, so none can be configured here.
          A <code>ws://</code> address is blocked when this page is served over https.
        </p>
        <label class="field grow">
          Message
          <textarea
            rows="4"
            spellcheck="false"
            [placeholder]="'Text to send. Variables like {{name}} are filled in.'"
            [value]="t.outgoing()"
            (input)="t.outgoing.set($any($event.target).value)"
          ></textarea>
        </label>
        <div class="actions">
          <button mat-flat-button type="button" [disabled]="!t.connected()" (click)="send()">Send (Ctrl+Enter)</button>
        </div>
      } @else {
        <p class="note">
          Event streams are one-way. The stream is read with fetch rather than EventSource, so request headers (such as
          Authorization) can be sent; cookies are not.
        </p>
        <div class="headers">
          <app-key-value-editor keyLabel="Header" [items]="t.headers()" (itemsChange)="t.headers.set($event)" />
        </div>
      }
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
      overflow: auto;
    }
    .bar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px;
    }
    .url {
      flex: 1 1 auto;
    }
    input,
    textarea {
      width: 100%;
      box-sizing: border-box;
      padding: 8px;
      font: inherit;
      color: inherit;
      background: transparent;
      border: 1px solid var(--mat-sys-outline);
      border-radius: 4px;
    }
    textarea {
      flex: 1 1 auto;
      min-height: 80px;
      font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      resize: vertical;
    }
    .field {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 0 12px 8px;
      font: var(--mat-sys-label-medium);
    }
    .grow {
      flex: 1 1 auto;
      min-height: 0;
    }
    .note {
      margin: 0 12px 8px;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    .actions {
      padding: 0 12px 12px;
    }
    .status {
      flex: 0 0 auto;
      padding: 2px 10px;
      border-radius: 12px;
      font: var(--mat-sys-label-medium);
      background: var(--mat-sys-surface-container-highest);
    }
    .status.open {
      background: color-mix(in srgb, #2e7d32 28%, var(--mat-sys-surface));
    }
    .status.error {
      background: var(--mat-sys-error-container);
      color: var(--mat-sys-on-error-container);
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
export class RealtimeEditorComponent {
  private readonly session = inject(RequestSession);
  protected readonly labels = STATUS_LABELS;
  protected readonly tab = this.session.activeRealtime;
  protected readonly websocket = computed(() => this.tab()?.kind === 'websocket');

  protected toggle(): void {
    const tab = this.tab();
    if (!tab) return;
    if (tab.busy()) tab.disconnect();
    else tab.connect();
  }

  protected send(): void {
    const tab = this.tab();
    if (tab?.kind === 'websocket' && tab.send(tab.outgoing())) {
      // Keep the text so the same message can be sent again, as in other API clients.
    }
  }
}
