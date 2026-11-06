import { Injectable, signal } from '@angular/core';

export interface TokenSet {
  readonly accessToken: string;
  readonly tokenType: string;
  /** Epoch milliseconds, or null when the server gave no lifetime. */
  readonly expiresAt: number | null;
  readonly refreshToken: string | null;
  readonly scope: string | null;
}

/** Tokens are treated as expired this long before they really are, so a request does not race the expiry. */
export const EXPIRY_SKEW_MS = 30_000;

export function isExpired(token: TokenSet, now = Date.now()): boolean {
  return token.expiresAt !== null && token.expiresAt - EXPIRY_SKEW_MS <= now;
}

/**
 * Access and refresh tokens, held in memory only. They are never written to
 * IndexedDB or to exports, so closing or reloading the page signs you out.
 */
@Injectable({ providedIn: 'root' })
export class OAuthTokenStore {
  private readonly tokens = signal<ReadonlyMap<string, TokenSet>>(new Map());

  get(key: string): TokenSet | undefined {
    return this.tokens().get(key);
  }

  set(key: string, token: TokenSet): void {
    this.tokens.update((map) => new Map(map).set(key, token));
  }

  remove(key: string): void {
    this.tokens.update((map) => {
      const next = new Map(map);
      next.delete(key);
      return next;
    });
  }

  clear(): void {
    this.tokens.set(new Map());
  }
}
