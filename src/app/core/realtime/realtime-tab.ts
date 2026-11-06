import { computed, signal } from '@angular/core';
import { KeyValue } from '../models';
import { prepareHeaders } from '../utils/header.util';
import { newId } from '../utils/id';
import { validateUrl } from '../utils/url.util';
import { resolveVariables, VariableMap } from '../utils/variable.util';
import {
  MAX_REALTIME_MESSAGES,
  MAX_REALTIME_TEXT,
  RealtimeKind,
  RealtimeMessage,
  RealtimeStatus,
} from './realtime.model';
import { SseParser } from './sse-parser.util';
import { WebSocketFactory, WebSocketLike } from './websocket-factory';

export interface RealtimeTabDependencies {
  readonly variables: () => VariableMap;
  readonly fetch: typeof fetch;
  readonly websocket: WebSocketFactory;
}

const SUBPROTOCOL = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/** Why a WebSocket closed, in words, for the codes users actually meet. */
function describeClose(code: number, reason: string): string {
  const meaning: Record<number, string> = {
    1000: 'normal closure',
    1001: 'going away',
    1006: 'closed abnormally: the connection dropped or was refused, and the browser does not say why',
    1008: 'policy violation',
    1009: 'message too big',
    1011: 'server error',
  };
  const text = meaning[code];
  return `Closed (code ${code}${text ? `: ${text}` : ''})${reason ? ` ${reason}` : ''}`;
}

/**
 * A WebSocket or Server-Sent Events connection shown as a tab. Holds the
 * connection, its log and the logic, so components only bind to signals.
 * These tabs are never saved to collections and never hold unsaved work.
 */
export class RealtimeTab {
  readonly id = newId();
  private nextMessageId = 1;
  private socket: WebSocketLike | null = null;
  private controller: AbortController | null = null;
  private lastEventId: string | null = null;

  readonly url = signal('');
  /** WebSocket subprotocols, comma separated. */
  readonly protocols = signal('');
  /** Request headers (event streams only: browsers do not let a WebSocket set any). */
  readonly headers = signal<readonly KeyValue[]>([]);
  /** The message being typed (WebSocket). */
  readonly outgoing = signal('');
  readonly status = signal<RealtimeStatus>('idle');
  readonly messages = signal<readonly RealtimeMessage[]>([]);

  readonly badge = computed(() => (this.kind === 'websocket' ? 'WS' : 'SSE'));
  readonly title = computed(() => this.url().trim() || (this.kind === 'websocket' ? 'New WebSocket' : 'New event stream'));
  /** Connections hold no unsaved work. */
  readonly dirty = computed(() => false);
  readonly connected = computed(() => this.status() === 'open');
  readonly busy = computed(() => this.status() === 'connecting' || this.status() === 'open');

  constructor(
    readonly kind: RealtimeKind,
    private readonly deps: RealtimeTabDependencies,
  ) {}

  connect(): void {
    if (this.busy()) return;
    if (this.kind === 'websocket') this.connectWebSocket();
    else void this.connectEventStream();
  }

  disconnect(): void {
    if (this.kind === 'websocket') {
      this.socket?.close(1000, 'Closed by the user');
    } else {
      this.controller?.abort();
    }
  }

  /** Sends a text message over an open WebSocket. Returns false when it could not be sent. */
  send(text: string): boolean {
    if (this.kind !== 'websocket' || this.status() !== 'open' || this.socket === null) return false;
    const resolved = resolveVariables(text, this.deps.variables());
    if (resolved.unresolved.length > 0) {
      this.log('info', `Variable ${resolved.unresolved.map((n) => `{{${n}}}`).join(', ')} is not defined and was sent as written.`);
    }
    try {
      this.socket.send(resolved.text);
    } catch {
      this.log('error', 'The message could not be sent.');
      return false;
    }
    this.log('out', resolved.text);
    return true;
  }

  clear(): void {
    this.messages.set([]);
  }

  /** Closes the connection. Called when the tab is closed. */
  dispose(): void {
    this.disconnect();
  }

  // --- WebSocket ---

  private connectWebSocket(): void {
    const resolved = resolveVariables(this.url().trim(), this.deps.variables());
    if (resolved.unresolved.length > 0) return this.fail(`Variable {{${resolved.unresolved[0]}}} is not defined. Select an environment that defines it.`);
    let target: URL;
    try {
      target = new URL(resolved.text);
    } catch {
      return this.fail('Enter a WebSocket URL such as wss://example.com/socket.');
    }
    if (target.protocol !== 'ws:' && target.protocol !== 'wss:') return this.fail('WebSocket URLs start with ws:// or wss://.');
    const protocols = this.protocols().split(',').map((p) => p.trim()).filter((p) => p !== '');
    if (protocols.some((p) => !SUBPROTOCOL.test(p))) return this.fail('A subprotocol contains characters that are not allowed.');

    this.status.set('connecting');
    this.log('info', `Connecting to ${target.href}…`);
    let socket: WebSocketLike;
    try {
      socket = this.deps.websocket(target.href, protocols);
    } catch (error) {
      const blocked = error instanceof DOMException && error.name === 'SecurityError';
      return this.fail(
        blocked
          ? 'The browser blocked the connection. A page served over https cannot open an insecure ws:// connection (mixed content); use wss://.'
          : 'The browser refused the URL or subprotocols.',
      );
    }
    socket.binaryType = 'blob';
    this.socket = socket;
    let opened = false;

    socket.onopen = () => {
      opened = true;
      this.status.set('open');
      this.log('info', 'Connected.');
    };
    socket.onmessage = (event) => {
      const data: unknown = event.data;
      if (typeof data === 'string') this.log('in', data);
      else if (data instanceof Blob) this.log('in', `(binary message, ${data.size} bytes)`, { binary: true, size: data.size });
      else this.log('in', '(message of an unsupported type)');
    };
    socket.onerror = () => {
      // Browsers deliberately give no detail about WebSocket failures.
      this.log('error', opened ? 'The connection reported an error.' : 'The connection failed. The browser does not say why: the server may be unreachable, may have refused the handshake or the origin, or the certificate may be invalid.');
    };
    socket.onclose = (event) => {
      this.socket = null;
      this.status.set(opened ? 'closed' : 'error');
      this.log('info', describeClose(event.code, event.reason));
    };
  }

  // --- Server-Sent Events ---

  private async connectEventStream(): Promise<void> {
    const variables = this.deps.variables();
    const resolved = resolveVariables(this.url().trim(), variables);
    if (resolved.unresolved.length > 0) return this.fail(`Variable {{${resolved.unresolved[0]}}} is not defined. Select an environment that defines it.`);
    const checked = validateUrl(resolved.text);
    if (!checked.ok) return this.fail(checked.reason);

    const prepared = prepareHeaders(this.headers(), variables);
    for (const warning of prepared.warnings) this.log('info', warning);
    const headers = new Headers({ Accept: 'text/event-stream', 'Cache-Control': 'no-cache' });
    for (const header of prepared.headers) headers.set(header.name, header.value);
    if (this.lastEventId !== null && !headers.has('Last-Event-ID')) headers.set('Last-Event-ID', this.lastEventId);

    const controller = new AbortController();
    this.controller = controller;
    this.status.set('connecting');
    this.log('info', `Connecting to ${checked.url.href}…`);

    try {
      const response = await this.deps.fetch(checked.url.href, { headers, signal: controller.signal, credentials: 'omit', cache: 'no-store' });
      if (!response.ok) {
        this.status.set('error');
        this.log('error', `The server answered ${response.status} ${response.statusText}`.trim() + '.');
        return;
      }
      const type = response.headers.get('content-type') ?? '';
      if (!type.toLowerCase().includes('text/event-stream')) {
        this.log('info', `The response is ${type || 'of unknown type'}, not text/event-stream. Events are shown if it is in that format.`);
      }
      this.status.set('open');
      this.log('info', 'Connected.');

      const parser = new SseParser((event) => {
        this.lastEventId = event.id;
        this.log('in', event.data, { event: event.event });
      });
      if (response.body === null) throw new TypeError('The response has no body.');
      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parser.push(decoder.decode(value, { stream: true }));
      }
      this.status.set('closed');
      this.log('info', 'The server closed the stream.');
    } catch (error) {
      if (controller.signal.aborted) {
        this.status.set('closed');
        this.log('info', 'Disconnected.');
      } else {
        this.status.set('error');
        this.log('error', error instanceof TypeError
          ? 'The connection failed or was interrupted. If this keeps happening, the server may be unreachable or may not allow requests from this origin (CORS); browsers do not say which.'
          : 'The stream failed.');
      }
    } finally {
      this.controller = null;
    }
  }

  // --- Log ---

  private fail(message: string): void {
    this.status.set('error');
    this.log('error', message);
  }

  private log(direction: RealtimeMessage['direction'], text: string, extra: { event?: string; binary?: boolean; size?: number } = {}): void {
    const truncated = text.length > MAX_REALTIME_TEXT;
    const message: RealtimeMessage = {
      id: this.nextMessageId++,
      direction,
      at: Date.now(),
      text: truncated ? text.slice(0, MAX_REALTIME_TEXT) : text,
      size: extra.size ?? text.length,
      ...(extra.event !== undefined ? { event: extra.event } : {}),
      ...(extra.binary ? { binary: true } : {}),
      ...(truncated ? { truncated: true } : {}),
    };
    this.messages.update((list) => [...(list.length >= MAX_REALTIME_MESSAGES ? list.slice(1) : list), message]);
  }
}
