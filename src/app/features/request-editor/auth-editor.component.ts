import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { AuthConfig } from '@core/models';
import { RequestSession } from '@core/services/request-session.service';

type AuthType = AuthConfig['type'];

const AUTH_TYPES: readonly { readonly value: AuthType; readonly label: string }[] = [
  { value: 'none', label: 'No Authentication' },
  { value: 'basic', label: 'Basic Authentication' },
  { value: 'bearer', label: 'Bearer Token' },
  { value: 'apiKey', label: 'API Key' },
  { value: 'custom', label: 'Custom Authorization Header' },
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
  }
}

@Component({
  selector: 'app-auth-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
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

      @if (auth().type !== 'none') {
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
    }
  `,
})
export class AuthEditorComponent {
  private readonly session = inject(RequestSession);
  protected readonly types = AUTH_TYPES;
  protected readonly auth = computed(() => this.session.draft().auth);

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
