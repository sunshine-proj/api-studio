import { base64Url, codeChallenge, createPkcePair, randomToken } from './pkce.util';

describe('PKCE', () => {
  it('matches the RFC 7636 appendix B test vector', async () => {
    expect(await codeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('encodes base64url without padding or unsafe characters', () => {
    expect(base64Url(new Uint8Array([251, 255, 254]))).toBe('-__-');
    expect(base64Url(new Uint8Array([1]))).toBe('AQ');
  });

  it('creates verifiers within the allowed length and alphabet, never repeating', async () => {
    const a = await createPkcePair();
    const b = await createPkcePair();
    expect(a.verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(a.verifier).not.toBe(b.verifier);
    expect(a.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await codeChallenge(a.verifier)).toBe(a.challenge);
  });

  it('generates random state values', () => {
    expect(randomToken(16)).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(randomToken(16)).not.toBe(randomToken(16));
  });
});
