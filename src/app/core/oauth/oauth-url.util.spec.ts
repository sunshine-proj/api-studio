import { buildAuthorizationUrl, checkOAuthEndpoint, isValidScope } from './oauth-url.util';

describe('OAuth URLs', () => {
  it('accepts https and local http endpoints only', () => {
    expect(checkOAuthEndpoint('https://id.example.com/authorize', 'x').ok).toBe(true);
    expect(checkOAuthEndpoint('http://localhost:8080/token', 'x').ok).toBe(true);
    expect(checkOAuthEndpoint('http://127.0.0.1/token', 'x').ok).toBe(true);
    for (const bad of ['http://id.example.com/token', 'ftp://x.test', 'javascript:alert(1)', 'data:text/html,x', 'id.example.com', '', '  ']) {
      expect(checkOAuthEndpoint(bad, 'token URL').ok).toBe(false);
    }
  });

  it('rejects embedded credentials and names the field in the message', () => {
    const result = checkOAuthEndpoint('https://user:pw@id.example.com/token', 'token URL');
    expect(result).toEqual({ ok: false, reason: 'The token URL must not contain a user name or password.' });
    expect(checkOAuthEndpoint('', 'token URL')).toEqual({ ok: false, reason: 'The token URL is empty.' });
  });

  it('validates scopes', () => {
    expect(isValidScope('')).toBe(true);
    expect(isValidScope('read write:all openid')).toBe(true);
    for (const bad of [' read', 'read ', 'read  write', 'read"write', 'a\nb', 'sçope']) expect(isValidScope(bad)).toBe(false);
  });

  it('builds a code + PKCE (S256) authorization URL, keeping existing query parameters', () => {
    const endpoint = new URL('https://id.example.com/authorize?audience=api');
    const url = new URL(
      buildAuthorizationUrl({ authorizationUrl: endpoint, clientId: 'app 1', redirectUri: 'https://studio.test/oauth/callback', scope: 'read write', state: 'st', challenge: 'ch' }),
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      audience: 'api', response_type: 'code', client_id: 'app 1', redirect_uri: 'https://studio.test/oauth/callback',
      scope: 'read write', state: 'st', code_challenge: 'ch', code_challenge_method: 'S256',
    });
    expect(url.searchParams.has('client_secret')).toBe(false);
    expect(endpoint.search).toBe('?audience=api'); // the input is not modified
  });

  it('omits an empty scope and never uses the implicit flow', () => {
    const url = new URL(buildAuthorizationUrl({ authorizationUrl: new URL('https://a.test/a'), clientId: 'c', redirectUri: 'https://s.test/cb', scope: '', state: 's', challenge: 'x' }));
    expect(url.searchParams.has('scope')).toBe(false);
    expect(url.searchParams.get('response_type')).toBe('code');
  });
});
