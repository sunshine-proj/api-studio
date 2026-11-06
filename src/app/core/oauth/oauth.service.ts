import { Injectable, computed, inject } from '@angular/core';
import { AuthConfig } from '../models';
import { FETCH_IMPLEMENTATION } from '../services/browser-fetch-executor.service';
import { EnvironmentStore } from '../services/environment-store.service';
import { resolveVariables, VariableMap } from '../utils/variable.util';
import { OAuthError } from './oauth-error';
import { OAUTH_CALLBACK_PATH, OAuthPopup } from './oauth-popup';
import { OAuthTokenStore, TokenSet, isExpired } from './oauth-token-store.service';
import { buildAuthorizationUrl, checkOAuthEndpoint, isValidScope } from './oauth-url.util';
import { createPkcePair, randomToken } from './pkce.util';

export type OAuthConfig = Extract<AuthConfig, { readonly type: 'oauth2' }>;

export type TokenStatus =
  | { readonly state: 'none' }
  | { readonly state: 'valid'; readonly expiresAt: number | null; readonly refreshable: boolean }
  | { readonly state: 'expired'; readonly refreshable: boolean };

export type TokenLookup = { readonly ok: true; readonly accessToken: string } | { readonly ok: false; readonly message: string };

/** Settings after `{{variables}}` were filled in and checked. */
interface ResolvedConfig {
  readonly authorizationUrl: URL | null;
  readonly tokenUrl: URL;
  readonly clientId: string;
  readonly scope: string;
}

/**
 * OAuth 2.0 Authorization Code flow with PKCE (S256), as a public client:
 * there is no client secret anywhere, the implicit flow does not exist, and
 * tokens live in memory only. The token endpoint is called straight from the
 * browser, so it must allow CORS for this app's origin.
 */
@Injectable({ providedIn: 'root' })
export class OAuthService {
  private readonly popup = inject(OAuthPopup);
  private readonly tokens = inject(OAuthTokenStore);
  private readonly environments = inject(EnvironmentStore);
  private readonly fetchImpl = inject(FETCH_IMPLEMENTATION);

  /** The redirect URI to register with the identity provider. */
  readonly redirectUri = computed(() => `${globalThis.location?.origin ?? ''}${OAUTH_CALLBACK_PATH}`);

  /** Whether a usable token exists for these settings (the settings may contain `{{variables}}`). */
  status(config: OAuthConfig, variables: VariableMap = this.environments.variables()): TokenStatus {
    const resolved = this.resolve(config, variables, false);
    const token = resolved === null ? undefined : this.tokens.get(this.keyOf(resolved));
    if (!token) return { state: 'none' };
    const refreshable = token.refreshToken !== null;
    return isExpired(token) ? { state: 'expired', refreshable } : { state: 'valid', expiresAt: token.expiresAt, refreshable };
  }

  forget(config: OAuthConfig, variables: VariableMap = this.environments.variables()): void {
    const resolved = this.resolve(config, variables, false);
    if (resolved) this.tokens.remove(this.keyOf(resolved));
  }

  /** Signs in through the provider's page. Resolves with the new token, or throws `OAuthError`. */
  async authorize(config: OAuthConfig, variables: VariableMap, signal: AbortSignal): Promise<TokenSet> {
    const resolved = this.resolve(config, variables, true);
    if (resolved === null || resolved.authorizationUrl === null) throw new OAuthError('The OAuth settings are incomplete.');
    const state = randomToken(16);
    const pkce = await createPkcePair();

    const callback = await this.popup.open(
      buildAuthorizationUrl({
        authorizationUrl: resolved.authorizationUrl,
        clientId: resolved.clientId,
        redirectUri: this.redirectUri(),
        scope: resolved.scope,
        state,
        challenge: pkce.challenge,
      }),
      signal,
    );
    if (callback.error !== null) {
      throw new OAuthError(`The provider refused the sign-in: ${callback.errorDescription ?? callback.error}.`);
    }
    // The state ties this response to the request that started it; a mismatch means it did not come from this sign-in.
    if (callback.state !== state) {
      throw new OAuthError('The sign-in response did not match the request (state mismatch), so it was ignored. Try again.');
    }
    if (callback.code === null || callback.code === '') throw new OAuthError('The provider did not return an authorization code.');

    const token = await this.requestToken(resolved, new URLSearchParams({
      grant_type: 'authorization_code',
      code: callback.code,
      redirect_uri: this.redirectUri(),
      client_id: resolved.clientId,
      code_verifier: pkce.verifier,
    }), null);
    this.tokens.set(this.keyOf(resolved), token);
    return token;
  }

  /** A usable access token: the stored one, a refreshed one, or an explanation of what to do. */
  async ensureToken(config: OAuthConfig, variables: VariableMap): Promise<TokenLookup> {
    let resolved: ResolvedConfig | null;
    try {
      resolved = this.resolve(config, variables, false, true);
    } catch (error) {
      return { ok: false, message: error instanceof OAuthError ? error.message : 'The OAuth settings are invalid.' };
    }
    const none: TokenLookup = { ok: false, message: 'No access token yet. Open the Authorization tab and choose "Get new token".' };
    if (resolved === null) return none;
    const key = this.keyOf(resolved);
    const token = this.tokens.get(key);
    if (!token) return none;
    if (!isExpired(token)) return { ok: true, accessToken: token.accessToken };

    if (token.refreshToken === null) {
      this.tokens.remove(key);
      return { ok: false, message: 'The access token has expired. Choose "Get new token" in the Authorization tab.' };
    }
    try {
      const refreshed = await this.requestToken(resolved, new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: token.refreshToken,
        client_id: resolved.clientId,
      }), token.refreshToken);
      this.tokens.set(key, refreshed);
      return { ok: true, accessToken: refreshed.accessToken };
    } catch (error) {
      this.tokens.remove(key);
      const reason = error instanceof OAuthError ? error.message : 'The token could not be refreshed.';
      return { ok: false, message: `The access token expired and could not be refreshed. ${reason} Choose "Get new token".` };
    }
  }

  // --- Internals ---

  private keyOf(config: ResolvedConfig): string {
    return [config.tokenUrl.href, config.clientId, config.scope].join('\n');
  }

  /**
   * Fills in variables and validates the settings. With `strict` it throws a
   * user-facing error for problems; otherwise it returns null for settings that
   * are not usable yet (for example while the user is still typing).
   */
  private resolve(config: OAuthConfig, variables: VariableMap, strict: boolean, needTokenOnly = false): ResolvedConfig | null {
    const fill = (text: string): string => resolveVariables(text, variables).text;
    const problem = (message: string): null => {
      if (strict || needTokenOnly) throw new OAuthError(message);
      return null;
    };
    const missing = [config.authorizationUrl, config.tokenUrl, config.clientId, config.scope]
      .flatMap((text) => resolveVariables(text, variables).unresolved);
    if (missing.length > 0) return problem(`The variable {{${missing[0]}}} is not defined. Select an environment that defines it.`);

    const clientId = fill(config.clientId).trim();
    if (clientId === '') return problem('The client ID is empty.');
    const scope = fill(config.scope).trim();
    if (!isValidScope(scope)) return problem('The scope must be space-separated values without quotes or special characters.');
    const token = checkOAuthEndpoint(fill(config.tokenUrl), 'token URL');
    if (!token.ok) return problem(token.reason);

    let authorizationUrl: URL | null = null;
    if (!needTokenOnly) {
      const auth = checkOAuthEndpoint(fill(config.authorizationUrl), 'authorization URL');
      if (!auth.ok) return problem(auth.reason);
      authorizationUrl = auth.url;
    }
    return { authorizationUrl, tokenUrl: token.url, clientId, scope };
  }

  private async requestToken(config: ResolvedConfig, body: URLSearchParams, previousRefreshToken: string | null): Promise<TokenSet> {
    let response: Response;
    try {
      response = await this.fetchImpl(config.tokenUrl.href, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: body.toString(),
        credentials: 'omit',
        cache: 'no-store',
      });
    } catch {
      throw new OAuthError(
        'The token endpoint could not be reached. It may be offline, or it may not allow requests from this origin (CORS). Browsers hide which. Providers must enable CORS on the token endpoint for browser apps.',
      );
    }
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new OAuthError(`The token endpoint answered ${response.status} with something that is not JSON.`);
    }
    const record = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
    if (!response.ok || typeof record['error'] === 'string') {
      const description = typeof record['error_description'] === 'string' ? record['error_description'] : typeof record['error'] === 'string' ? record['error'] : `HTTP ${response.status}`;
      throw new OAuthError(`The token endpoint refused the request: ${description}.`);
    }
    const accessToken = record['access_token'];
    if (typeof accessToken !== 'string' || accessToken === '') throw new OAuthError('The token response contains no access token.');
    const expiresIn = typeof record['expires_in'] === 'number' ? record['expires_in'] : Number(record['expires_in']);
    return {
      accessToken,
      tokenType: typeof record['token_type'] === 'string' ? record['token_type'] : 'Bearer',
      expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? Date.now() + expiresIn * 1000 : null,
      refreshToken: typeof record['refresh_token'] === 'string' ? record['refresh_token'] : previousRefreshToken,
      scope: typeof record['scope'] === 'string' ? record['scope'] : null,
    };
  }
}
