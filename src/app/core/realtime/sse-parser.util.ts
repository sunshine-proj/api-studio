export interface SseEvent {
  /** The event type, "message" when the server named none. */
  readonly event: string;
  readonly data: string;
  /** The last event id seen on this stream (it persists across events, as the spec requires). */
  readonly id: string | null;
  /** Reconnection delay requested by the server, in milliseconds. */
  readonly retry: number | null;
}

/**
 * Incremental parser for `text/event-stream` (the Server-Sent Events wire
 * format). Feed it text as it arrives; chunks may split a line, or even a
 * `\r\n` pair, anywhere. Fetch is used instead of `EventSource` so headers can
 * be sent, which `EventSource` does not allow.
 */
export class SseParser {
  private buffer = '';
  private started = false;
  private data: string[] = [];
  private eventType = '';
  private lastId: string | null = null;
  private retry: number | null = null;

  constructor(private readonly onEvent: (event: SseEvent) => void) {}

  /** The id of the last event, for the `Last-Event-ID` header when reconnecting. */
  get lastEventId(): string | null {
    return this.lastId;
  }

  push(chunk: string): void {
    if (!this.started) {
      this.started = true;
      if (chunk.startsWith('﻿')) chunk = chunk.slice(1);
    }
    this.buffer += chunk;

    let start = 0;
    for (;;) {
      const lf = this.buffer.indexOf('\n', start);
      const cr = this.buffer.indexOf('\r', start);
      const end = lf === -1 ? cr : cr === -1 ? lf : Math.min(lf, cr);
      if (end === -1) break;
      // A "\r" at the very end may be the first half of "\r\n": wait for the next chunk to find out.
      if (this.buffer[end] === '\r' && end === this.buffer.length - 1) break;
      const terminatorLength = this.buffer[end] === '\r' && this.buffer[end + 1] === '\n' ? 2 : 1;
      this.line(this.buffer.slice(start, end));
      start = end + terminatorLength;
    }
    this.buffer = this.buffer.slice(start);
  }

  private line(line: string): void {
    if (line === '') return this.dispatch();
    if (line.startsWith(':')) return; // comment (often used as a keep-alive)
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);

    switch (field) {
      case 'event':
        this.eventType = value;
        break;
      case 'data':
        this.data.push(value);
        break;
      case 'id':
        if (!value.includes('\0')) this.lastId = value;
        break;
      case 'retry':
        if (/^\d+$/.test(value)) this.retry = Number(value);
        break;
    }
  }

  private dispatch(): void {
    if (this.data.length > 0) {
      this.onEvent({ event: this.eventType || 'message', data: this.data.join('\n'), id: this.lastId, retry: this.retry });
    }
    this.data = [];
    this.eventType = '';
    this.retry = null;
  }
}
