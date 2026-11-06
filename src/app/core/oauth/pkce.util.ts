/** Base64url without padding, as RFC 7636 requires. */
export function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** An unguessable random string from the browser's secure random generator. */
export function randomToken(byteLength: number): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

/** S256 code challenge: base64url(SHA-256(verifier)). */
export async function codeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

export interface PkcePair {
  readonly verifier: string;
  readonly challenge: string;
}

/** A fresh verifier (64 random bytes, 86 characters, within RFC 7636's 43 to 128) and its S256 challenge. */
export async function createPkcePair(): Promise<PkcePair> {
  const verifier = randomToken(64);
  return { verifier, challenge: await codeChallenge(verifier) };
}
