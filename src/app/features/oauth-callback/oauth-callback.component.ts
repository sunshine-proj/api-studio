import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { OAUTH_CHANNEL, OAuthCallbackParams } from '@core/oauth/oauth-popup';

/**
 * The page an identity provider redirects to after sign-in. It hands the
 * `code` and `state` (or the error) to the app window over a same-origin
 * BroadcastChannel and closes itself. It does nothing else and shows nothing
 * sensitive; the code is only useful together with the PKCE verifier that
 * never leaves the app window.
 */
@Component({
  selector: 'app-oauth-callback',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main>
      <h1>{{ failed() ? 'Sign-in could not be completed' : 'Signed in' }}</h1>
      <p role="status">{{ message() }}</p>
    </main>
  `,
  styles: `
    main {
      max-width: 480px;
      margin: 15vh auto;
      padding: 0 16px;
      text-align: center;
    }
  `,
})
export class OAuthCallbackComponent {
  protected readonly failed = signal(false);
  protected readonly message = signal('Returning to API Studio…');

  constructor() {
    const query = new URLSearchParams(window.location.search);
    const params: OAuthCallbackParams = {
      code: query.get('code'),
      state: query.get('state'),
      error: query.get('error'),
      errorDescription: query.get('error_description'),
    };
    if (typeof BroadcastChannel === 'undefined') {
      this.failed.set(true);
      this.message.set('This browser cannot pass the sign-in result back to API Studio. Close this window and try another browser.');
      return;
    }
    const channel = new BroadcastChannel(OAUTH_CHANNEL);
    channel.postMessage(params);
    channel.close();
    // Remove the code from the address bar and history before closing.
    window.history.replaceState(null, '', window.location.pathname);
    this.message.set('You can close this window.');
    window.close();
  }
}
