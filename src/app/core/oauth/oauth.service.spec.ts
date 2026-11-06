import { TestBed } from '@angular/core/testing';
import { ApiStudioDatabase, DATABASE_NAME } from '../database/database.service';
import { FETCH_IMPLEMENTATION } from '../services/browser-fetch-executor.service';
import { OAuthError } from './oauth-error';
import { OAuthCallbackParams, OAuthPopup } from './oauth-popup';
import { OAuthTokenStore } from './oauth-token-store.service';
import { OAuthConfig, OAuthService } from './oauth.service';
import { codeChallenge } from './pkce.util';

let counter = 0;

class FakePopup extends OAuthPopup {
  urls: URL[] = [];
  /** Decides what the "provider" redirects back with. Defaults to a correct approval. */
  respond: (url: URL) => OAuthCallbackParams | Promise<OAuthCallbackParams> = (url) => ({
    code: 'auth-code-1',
    state: url.searchParams.get('state'),
    error: null,
    errorDescription: null,
  });

  open(url: string): Promise<OAuthCallbackParams> {
    const parsed = new URL(url);
    this.urls.push(parsed);
    return Promise.resolve(this.respond(parsed));
  }
}

interface TokenCall {
  url: string;
  body: URLSearchParams;
  init: RequestInit;
}

const config: OAuthConfig = {
  type: 'oauth2',
  authorizationUrl: 'https://id.test/authorize',
  tokenUrl: 'https://id.test/token',
  clientId: 'app-1',
  scope: 'read write',
};

describe('OAuthService', () => {
  let dbName: string;
  let popup: FakePopup;
  let calls: TokenCall[];
  let tokenResponse: () => Response | Promise<Response>;
  let service: OAuthService;

  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  beforeEach(() => {
    dbName = `oauth-db-${++counter}`;
    popup = new FakePopup();
    calls = [];
    tokenResponse = () => json({ access_token: 'at-1', token_type: 'Bearer', expires_in: 3600, refresh_token: 'rt-1', scope: 'read write' });
    TestBed.configureTestingModule({
      providers: [
        { provide: DATABASE_NAME, useValue: dbName },
        { provide: OAuthPopup, useValue: popup },
        {
          provide: FETCH_IMPLEMENTATION,
          useValue: (url: string, init: RequestInit) => {
            calls.push({ url, body: new URLSearchParams(String(init.body)), init });
            return Promise.resolve(tokenResponse());
          },
        },
      ],
    });
    service = TestBed.inject(OAuthService);
  });

  afterEach(async () => {
    TestBed.resetTestingModule();
    await new ApiStudioDatabase(dbName).delete();
  });

  const signal = () => new AbortController().signal;

  it('runs the authorization code flow with PKCE and exchanges the code with the verifier', async () => {
    const token = await service.authorize(config, new Map(), signal());

    const auth = popup.urls[0];
    expect(auth.origin + auth.pathname).toBe('https://id.test/authorize');
    expect(Object.fromEntries(auth.searchParams)).toMatchObject({
      response_type: 'code', client_id: 'app-1', scope: 'read write', code_challenge_method: 'S256', redirect_uri: service.redirectUri(),
    });
    expect(service.redirectUri()).toMatch(/\/oauth\/callback$/);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://id.test/token');
    expect(Object.fromEntries(calls[0].body)).toMatchObject({
      grant_type: 'authorization_code', code: 'auth-code-1', client_id: 'app-1', redirect_uri: service.redirectUri(),
    });
    // The verifier sent to the token endpoint must be the one the challenge was made from.
    expect(await codeChallenge(calls[0].body.get('code_verifier')!)).toBe(auth.searchParams.get('code_challenge'));
    expect(token).toMatchObject({ accessToken: 'at-1', refreshToken: 'rt-1', scope: 'read write' });
  });

  it('never sends a client secret and keeps the request credential-free', async () => {
    await service.authorize(config, new Map(), signal());
    expect(calls[0].body.has('client_secret')).toBe(false);
    expect(popup.urls[0].searchParams.has('client_secret')).toBe(false);
    expect(calls[0].init.credentials).toBe('omit');
    expect(calls[0].init.method).toBe('POST');
  });

  it('uses a fresh state and verifier for every sign-in', async () => {
    await service.authorize(config, new Map(), signal());
    await service.authorize(config, new Map(), signal());
    expect(popup.urls[0].searchParams.get('state')).not.toBe(popup.urls[1].searchParams.get('state'));
    expect(calls[0].body.get('code_verifier')).not.toBe(calls[1].body.get('code_verifier'));
  });

  it('rejects a response whose state does not match, without calling the token endpoint', async () => {
    popup.respond = () => ({ code: 'stolen', state: 'attacker-state', error: null, errorDescription: null });
    await expect(service.authorize(config, new Map(), signal())).rejects.toThrow(/state mismatch/);
    expect(calls).toEqual([]);
    expect(service.status(config).state).toBe('none');
  });

  it('reports a provider error and a missing code', async () => {
    popup.respond = () => ({ code: null, state: null, error: 'access_denied', errorDescription: 'User said no' });
    await expect(service.authorize(config, new Map(), signal())).rejects.toThrow('The provider refused the sign-in: User said no.');
    popup.respond = (url) => ({ code: null, state: url.searchParams.get('state'), error: null, errorDescription: null });
    await expect(service.authorize(config, new Map(), signal())).rejects.toThrow(/did not return an authorization code/);
    expect(calls).toEqual([]);
  });

  it('refuses unsafe or incomplete settings before opening anything', async () => {
    const cases: [Partial<OAuthConfig>, RegExp][] = [
      [{ authorizationUrl: 'http://id.test/authorize' }, /authorization URL must use https/],
      [{ tokenUrl: 'http://id.test/token' }, /token URL must use https/],
      [{ tokenUrl: 'https://u:p@id.test/token' }, /must not contain a user name/],
      [{ clientId: '  ' }, /client ID is empty/],
      [{ scope: 'a"b' }, /scope must be/],
      [{ clientId: '{{missing}}' }, /\{\{missing\}\} is not defined/],
    ];
    for (const [override, message] of cases) {
      await expect(service.authorize({ ...config, ...override }, new Map(), signal())).rejects.toThrow(message);
    }
    expect(popup.urls).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('fills in variables in the settings', async () => {
    await service.authorize({ ...config, clientId: '{{clientId}}', scope: '{{scope}}' }, new Map([['clientId', 'from-env'], ['scope', 'openid']]), signal());
    expect(popup.urls[0].searchParams.get('client_id')).toBe('from-env');
    expect(popup.urls[0].searchParams.get('scope')).toBe('openid');
  });

  it('explains token endpoint failures in plain words', async () => {
    tokenResponse = () => json({ error: 'invalid_grant', error_description: 'Code expired' }, 400);
    await expect(service.authorize(config, new Map(), signal())).rejects.toThrow('The token endpoint refused the request: Code expired.');
    tokenResponse = () => json({ token_type: 'Bearer' });
    await expect(service.authorize(config, new Map(), signal())).rejects.toThrow(/no access token/);
    tokenResponse = () => new Response('<html>', { status: 502 });
    await expect(service.authorize(config, new Map(), signal())).rejects.toThrow(/not JSON/);
    tokenResponse = () => Promise.reject(new TypeError('Failed to fetch'));
    await expect(service.authorize(config, new Map(), signal())).rejects.toThrow(/possibly|CORS/);
    expect(service.status(config).state).toBe('none');
  });

  it('stores tokens in memory only and reports their status', async () => {
    expect(service.status(config)).toEqual({ state: 'none' });
    await service.authorize(config, new Map(), signal());
    expect(service.status(config)).toMatchObject({ state: 'valid', refreshable: true });
    expect(await service.ensureToken(config, new Map())).toEqual({ ok: true, accessToken: 'at-1' });
    expect(JSON.stringify(Object.entries(localStorage))).not.toContain('at-1');
    service.forget(config);
    expect(service.status(config)).toEqual({ state: 'none' });
  });

  it('asks the user to sign in when there is no token', async () => {
    const result = await service.ensureToken(config, new Map());
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining('Get new token') });
  });

  it('keeps separate tokens for separate clients and scopes', async () => {
    await service.authorize(config, new Map(), signal());
    expect(service.status({ ...config, scope: 'other' }).state).toBe('none');
    expect(service.status({ ...config, clientId: 'app-2' }).state).toBe('none');
  });

  describe('expiry', () => {
    it('refreshes an expired token with the refresh token (no client secret)', async () => {
      await service.authorize(config, new Map(), signal());
      const key = ['https://id.test/token', 'app-1', 'read write'].join('\n');
      const store = TestBed.inject(OAuthTokenStore);
      store.set(key, { ...store.get(key)!, expiresAt: Date.now() - 1000 });
      expect(service.status(config)).toMatchObject({ state: 'expired', refreshable: true });

      tokenResponse = () => json({ access_token: 'at-2', expires_in: 60 });
      expect(await service.ensureToken(config, new Map())).toEqual({ ok: true, accessToken: 'at-2' });
      const refresh = calls.at(-1)!.body;
      expect(Object.fromEntries(refresh)).toEqual({ grant_type: 'refresh_token', refresh_token: 'rt-1', client_id: 'app-1' });
      expect(store.get(key)?.refreshToken).toBe('rt-1'); // kept when the server does not rotate it
    });

    it('treats a token about to expire as expired', async () => {
      await service.authorize(config, new Map(), signal());
      const key = ['https://id.test/token', 'app-1', 'read write'].join('\n');
      const store = TestBed.inject(OAuthTokenStore);
      store.set(key, { ...store.get(key)!, expiresAt: Date.now() + 5_000 });
      expect(service.status(config).state).toBe('expired');
    });

    it('drops the token and asks to sign in again when it cannot be refreshed', async () => {
      await service.authorize(config, new Map(), signal());
      const key = ['https://id.test/token', 'app-1', 'read write'].join('\n');
      const store = TestBed.inject(OAuthTokenStore);
      store.set(key, { ...store.get(key)!, expiresAt: Date.now() - 1 });
      tokenResponse = () => json({ error: 'invalid_grant' }, 400);
      const result = await service.ensureToken(config, new Map());
      expect(result).toMatchObject({ ok: false, message: expect.stringContaining('could not be refreshed') });
      expect(service.status(config).state).toBe('none');
    });

    it('asks to sign in again when an expired token has no refresh token', async () => {
      tokenResponse = () => json({ access_token: 'at-x', expires_in: 1 });
      await service.authorize(config, new Map(), signal());
      const key = ['https://id.test/token', 'app-1', 'read write'].join('\n');
      const store = TestBed.inject(OAuthTokenStore);
      store.set(key, { ...store.get(key)!, expiresAt: Date.now() - 1 });
      const result = await service.ensureToken(config, new Map());
      expect(result).toMatchObject({ ok: false, message: expect.stringContaining('has expired') });
    });
  });

  it('can be cancelled by the user', async () => {
    popup.respond = () => Promise.reject(new OAuthError('Sign-in was cancelled.'));
    await expect(service.authorize(config, new Map(), signal())).rejects.toThrow('Sign-in was cancelled.');
  });
});
