const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]']);

export type EndpointCheck = { readonly ok: true; readonly url: URL } | { readonly ok: false; readonly reason: string };

/**
 * An OAuth endpoint must be https (http is only allowed for localhost, for
 * local development) and must not embed a user name or password. Anything else
 * would send authorization codes or tokens over a readable connection.
 */
export function checkOAuthEndpoint(text: string, label: string): EndpointCheck {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: false, reason: `The ${label} is empty.` };
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, reason: `The ${label} is not a valid URL.` };
  }
  if (url.username !== '' || url.password !== '') {
    return { ok: false, reason: `The ${label} must not contain a user name or password.` };
  }
  if (url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname))) {
    return { ok: true, url };
  }
  return { ok: false, reason: `The ${label} must use https (http is only allowed for localhost).` };
}

/** Scope values are space-separated tokens of printable characters (RFC 6749 section 3.3). */
export function isValidScope(scope: string): boolean {
  return scope === '' || /^[\x21\x23-\x5B\x5D-\x7E]+( [\x21\x23-\x5B\x5D-\x7E]+)*$/.test(scope);
}

export interface AuthorizationRequest {
  readonly authorizationUrl: URL;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly scope: string;
  readonly state: string;
  readonly challenge: string;
}

/** The URL the user is sent to. Always the code flow with PKCE (S256): there is no implicit flow here. */
export function buildAuthorizationUrl(request: AuthorizationRequest): string {
  const url = new URL(request.authorizationUrl.href);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', request.clientId);
  url.searchParams.set('redirect_uri', request.redirectUri);
  if (request.scope !== '') url.searchParams.set('scope', request.scope);
  url.searchParams.set('state', request.state);
  url.searchParams.set('code_challenge', request.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.href;
}
