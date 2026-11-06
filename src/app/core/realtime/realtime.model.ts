export type RealtimeKind = 'websocket' | 'sse';
export type RealtimeStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

/** One line of a connection's log. */
export interface RealtimeMessage {
  readonly id: number;
  /** `in` came from the server, `out` was sent by the user, `info` and `error` describe the connection. */
  readonly direction: 'in' | 'out' | 'info' | 'error';
  readonly at: number;
  readonly text: string;
  /** Original size in bytes (or characters for text) before any shortening. */
  readonly size: number;
  /** SSE event name. */
  readonly event?: string;
  readonly binary?: boolean;
  readonly truncated?: boolean;
}

/** Most messages kept per connection; older ones are dropped. */
export const MAX_REALTIME_MESSAGES = 1000;
/** Longest message text kept; longer ones are shortened (and flagged). */
export const MAX_REALTIME_TEXT = 100_000;
