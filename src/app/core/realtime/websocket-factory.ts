import { InjectionToken } from '@angular/core';

/** The part of `WebSocket` the app uses, so tests can provide a fake. */
export interface WebSocketLike {
  binaryType: BinaryType;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export type WebSocketFactory = (url: string, protocols: readonly string[]) => WebSocketLike;

export const WEBSOCKET_FACTORY = new InjectionToken<WebSocketFactory>('WEBSOCKET_FACTORY', {
  providedIn: 'root',
  factory: () => (url, protocols) => new WebSocket(url, [...protocols]),
});
