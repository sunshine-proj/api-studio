import { Injectable, inject } from '@angular/core';
import { OAuthError } from './oauth-error';

/** Path of the page the identity provider redirects back to. Register `<origin>` + this path as the redirect URI. */
export const OAUTH_CALLBACK_PATH = '/oauth/callback';
export const OAUTH_CHANNEL = 'api-studio-oauth';
/** How long to wait for the user to finish signing in. */
export const OAUTH_TIMEOUT_MS = 5 * 60_000;

/** What the identity provider put in the redirect. */
export interface OAuthCallbackParams {
  readonly code: string | null;
  readonly state: string | null;
  readonly error: string | null;
  readonly errorDescription: string | null;
}

/** Shows the provider's sign-in page and returns where it redirected to. Replaceable in tests. */
@Injectable({ providedIn: 'root', useFactory: () => inject(BrowserOAuthPopup) })
export abstract class OAuthPopup {
  abstract open(url: string, signal: AbortSignal): Promise<OAuthCallbackParams>;
}

function isParams(value: unknown): value is OAuthCallbackParams {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return ['code', 'state', 'error', 'errorDescription'].every((key) => v[key] === null || typeof v[key] === 'string');
}

/**
 * Opens the sign-in page in a popup and waits for the callback page to report
 * back over a same-origin BroadcastChannel. The popup is opened with
 * `noopener`, so the provider's page gets no handle to this window; the cost is
 * that a blocked popup cannot be detected, so the UI says what to look for.
 */
@Injectable({ providedIn: 'root' })
export class BrowserOAuthPopup extends OAuthPopup {
  open(url: string, signal: AbortSignal): Promise<OAuthCallbackParams> {
    return new Promise((resolve, reject) => {
      if (typeof BroadcastChannel === 'undefined') {
        reject(new OAuthError('This browser does not support the features OAuth sign-in needs (BroadcastChannel).'));
        return;
      }
      const channel = new BroadcastChannel(OAUTH_CHANNEL);
      const finish = (): void => {
        clearTimeout(timer);
        channel.close();
        signal.removeEventListener('abort', onAbort);
      };
      const onAbort = (): void => {
        finish();
        reject(new OAuthError('Sign-in was cancelled.'));
      };
      const timer = setTimeout(() => {
        finish();
        reject(new OAuthError('Sign-in timed out. Try again.'));
      }, OAUTH_TIMEOUT_MS);

      channel.onmessage = (event: MessageEvent<unknown>) => {
        if (!isParams(event.data)) return; // ignore anything that is not our callback page
        finish();
        resolve(event.data);
      };
      if (signal.aborted) return onAbort();
      signal.addEventListener('abort', onAbort, { once: true });
      window.open(url, '_blank', 'popup,width=520,height=720,noopener');
    });
  }
}
