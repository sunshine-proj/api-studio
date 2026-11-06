import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { AuthConfig } from '@core/models';
import { OAuthError } from '@core/oauth/oauth-error';
import { OAuthConfig, OAuthService, TokenStatus } from '@core/oauth/oauth.service';
import { EnvironmentStore } from '@core/services/environment-store.service';
import { RequestSession } from '@core/services/request-session.service';

type AuthType = AuthConfig['type'];

const AUTH_TYPES: readonly { readonly value: AuthType; readonly label: string }[] = [
  { value: 'none', label: 'No Authentication' },
  { value: 'basic', label: 'Basic Authentication' },
  { value: 'bearer', label: 'Bearer Token' },
  { value: 'apiKey', label: 'API Key' },
  { value: 'custom', label: 'Custom Authorization Header' },
  { value: 'oauth2', label: 'OAuth 2.0 (Authorization Code + PKCE)' },
];

function defaultAuth(type: AuthType): AuthConfig {
  switch (type) {
    case 'none':
      return { type };
    case 'basic':
      return { type, username: '', password: '' };
    case 'bearer':
      return { type, token: '' };
    case 'apiKey':
      return { type, key: '', value: '', placement: 'header' };
    case 'custom':
      return { type, headerName: 'Authorization', headerValue: '' };
    case 'oauth2':
      return { type, authorizationUrl: '', tokenUrl: '', clientId: '', scope: '' };
  }
}

@Component({
  selector: 'app-auth-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, MatButton],
  template: `
    <div class="form">
      <label class="field">
        Type
        <select [value]="auth().type" (change)="setType($any($event.target).value)">
          @for (option of types; track option.value) {
            <option [value]="option.value" [selected]="option.value === auth().type">{{ option.label }}</option>
          }
        </select>
      </label>

      @switch (auth().type) {
        @case ('basic') {
          <label class="field">
            Username
            <input autocomplete="off" [value]="text('username')" (input)="update('username', $any($event.target).value)" />
          </label>
          <label class="field">
            Password
            <input type="password" autocomplete="off" [value]="text('password')" (input)="update('password', $any($event.target).value)" />
          </label>
        }
        @case ('bearer') {
          <label class="field">
            Token
            <input type="password" autocomplete="off" [value]="text('token')" (input)="update('token', $any($event.target).value)" />
          </label>
        }
        @case ('apiKey') {
          <label class="field">
            Key name
            <input autocomplete="off" [value]="text('key')" (input)="update('key', $any($event.target).value)" />
          </label>
          <label class="field">
            Key value
            <input type="password" autocomplete="off" [value]="text('value')" (input)="update('value', $any($event.target).value)" />
          </label>
          <label class="field">
            Add to
            <select [value]="text('placement')" (change)="update('placement', $any($event.target).value)">
              <option value="header" [selected]="text('placement') === 'header'">Header</option>
              <option value="query" [selected]="text('placement') === 'query'">Query parameter</option>
            </select>
          </label>
        }
        @case ('custom') {
          <label class="field">
            Header name
            <input autocomplete="off" [value]="text('headerName')" (input)="update('headerName', $any($event.target).value)" />
          </label>
          <label class="field">
            Header value
            <input type="password" autocomplete="off" [value]="text('headerValue')" (input)="update('headerValue', $any($event.target).value)" />
          </label>
        }
      }

      @if (auth().type === 'oauth2') {
        <label class="field">
          Authorization URL
          <input autocomplete="off" placeholder="https://id.example.com/oauth/authorize" [value]="text('authorizationUrl')" (input)="update('authorizationUrl', $any($event.target).value)" />
        </label>
        <label class="field">
          Token URL
          <input autocomplete="off" placeholder="https://id.example.com/oauth/token" [value]="text('tokenUrl')" (input)="update('tokenUrl', $any($event.target).value)" />
        </label>
        <label class="field">
          Client ID
          <input autocomplete="off" [value]="text('clientId')" (input)="update('clientId', $any($event.target).value)" />
        </label>
        <label class="field">
          Scope (optional, separated by spaces)
          <input autocomplete="off" [value]="text('scope')" (input)="update('scope', $any($event.target).value)" />
        </label>

        <div class="note">
          <p>
            Redirect URI to register with the provider: <code>{{ redirectUri() }}</code>
          </p>
          <p>
            This uses the authorization code flow with PKCE, as a public client: there is no client secret, and the
            access token is kept in memory only (reloading the page signs you out). The provider's token endpoint must
            allow CORS requests from this app, or the browser will block the token request.
          </p>
        </div>

        <div class="token" role="group" aria-label="OAuth token">
          @switch (tokenStatus().state) {
            @case ('valid') {
              <p class="status ok" role="status">
                Signed in.
                @if (expiry(); as at) {
                  Token expires {{ at | date: 'mediumTime' }}.
                } @else {
                  The server gave the token no expiry.
                }
              </p>
            }
            @case ('expired') {
              <p class="status warn" role="status">
                The token has expired.
                @if (refreshable()) {
                  It will be refreshed automatically when you send.
                } @else {
                  Get a new one.
                }
              </p>
            }
            @default {
              <p class="status" role="status">Not signed in.</p>
            }
          }
          @if (signingIn()) {
            <p class="note" role="status">
              Waiting for you to sign in in the new window. If no window appeared, your browser may have blocked the
              pop-up: allow pop-ups for this site and try again.
            </p>
            <button mat-stroked-button type="button" (click)="cancelSignIn()">Cancel</button>
          } @else {
            <div class="actions">
              <button mat-flat-button type="button" (click)="signIn()">Get new token</button>
              @if (tokenStatus().state !== 'none') {
                <button mat-stroked-button type="button" (click)="forget()">Clear token</button>
              }
            </div>
          }
          @if (error(); as message) {
            <p class="error" role="alert">{{ message }}</p>
          }
        </div>
      }

      @if (auth().type !== 'none' && auth().type !== 'oauth2') {
        <p class="note">
          Use variables such as <code ngNonBindable>{{token}}</code> to avoid typing secrets into the request.
          Credentials are kept unencrypted in this browser and are replaced in the headers sent. They override a
          header of the same name from the Headers tab.
        </p>
      }
    </div>
  `,
  styles: `
    .form {
      display: flex;
      flex-direction: column;
      gap: 10px;
      max-width: 480px;
      padding: 12px;
    }
    .field {
      display: flex;
      flex-direction: column;
      gap: 4px;
      font: var(--mat-sys-label-medium);
    }
    input,
    select {
      height: 32px;
      padding: 0 8px;
      font: var(--mat-sys-body-medium);
      color: inherit;
      background: transparent;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 4px;
    }
    .note {
      margin: 0;
      font: var(--mat-sys-body-small);
      color: var(--mat-sys-on-surface-variant);

      p {
        margin: 0 0 6px;
      }
    }
    .token {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 10px 12px;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 8px;
    }
    .status {
      margin: 0;
      font-weight: 600;
    }
    .status.ok {
      color: var(--app-success);
    }
    .status.warn {
      color: var(--app-warning);
    }
    .actions {
      display: flex;
      gap: 8px;
    }
    .error {
      margin: 0;
      color: var(--mat-sys-error);
    }
  `,
})
export class AuthEditorComponent {
  private readonly session = inject(RequestSession);
  private readonly oauth = inject(OAuthService);
  private readonly environments = inject(EnvironmentStore);
  private signInController: AbortController | null = null;
  protected readonly signingIn = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly redirectUri = this.oauth.redirectUri;
  protected readonly types = AUTH_TYPES;
  protected readonly auth = computed(() => this.session.draft().auth);

  private readonly oauthConfig = computed<OAuthConfig | null>(() => {
    const auth = this.auth();
    return auth.type === 'oauth2' ? auth : null;
  });
  protected readonly tokenStatus = computed<TokenStatus>(() => {
    const config = this.oauthConfig();
    return config ? this.oauth.status(config, this.environments.variables()) : { state: 'none' };
  });
  protected readonly refreshable = computed(() => {
    const status = this.tokenStatus();
    return status.state !== 'none' && status.refreshable;
  });
  protected readonly expiry = computed(() => {
    const status = this.tokenStatus();
    return status.state === 'valid' ? status.expiresAt : null;
  });

  protected async signIn(): Promise<void> {
    const config = this.oauthConfig();
    if (!config) return;
    this.error.set(null);
    this.signInController = new AbortController();
    this.signingIn.set(true);
    try {
      await this.oauth.authorize(config, this.environments.variables(), this.signInController.signal);
    } catch (error) {
      this.error.set(error instanceof OAuthError ? error.message : 'Sign-in failed.');
    } finally {
      this.signingIn.set(false);
      this.signInController = null;
    }
  }

  protected cancelSignIn(): void {
    this.signInController?.abort();
  }

  protected forget(): void {
    const config = this.oauthConfig();
    if (config) this.oauth.forget(config, this.environments.variables());
    this.error.set(null);
  }

  protected setType(type: AuthType): void {
    if (type !== this.auth().type) {
      this.session.setAuth(defaultAuth(type));
    }
  }

  /** Reads a string field of the current auth config (empty when the type has no such field). */
  protected text(field: string): string {
    const value = (this.auth() as unknown as Record<string, unknown>)[field];
    return typeof value === 'string' ? value : '';
  }

  /** Updates one field. Fields are only rendered for the type that owns them. */
  protected update(field: string, value: string): void {
    this.session.setAuth({ ...this.auth(), [field]: value } as AuthConfig);
  }
}
