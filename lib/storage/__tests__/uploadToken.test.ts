import { beforeAll, describe, expect, it } from 'vitest';

import { signUploadToken, verifyUploadToken } from '../uploadToken';

beforeAll(() => {
  // HS256 signing key — the helper reads process.env.AUTH_SECRET as a fallback.
  process.env.AUTH_SECRET = 'test-secret-at-least-32-characters-long!!';
});

const claims = {
  key: 'exercises/img/u1/20260601/abc.jpg',
  contentType: 'image/jpeg',
  maxBytes: 5_000_000,
};

describe('uploadToken', () => {
  it('round-trips valid claims', async () => {
    const token = await signUploadToken(claims);
    expect(await verifyUploadToken(token)).toEqual(claims);
  });

  it('rejects a tampered token', async () => {
    const token = await signUploadToken(claims);
    const tampered = token.slice(0, -3) + (token.slice(-3) === 'aaa' ? 'bbb' : 'aaa');
    expect(await verifyUploadToken(tampered)).toBeNull();
  });

  it('rejects garbage', async () => {
    expect(await verifyUploadToken('not-a-jwt')).toBeNull();
    expect(await verifyUploadToken('')).toBeNull();
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await signUploadToken(claims);
    process.env.AUTH_SECRET = 'a-totally-different-secret-key-32-chars!!';
    const result = await verifyUploadToken(token);
    process.env.AUTH_SECRET = 'test-secret-at-least-32-characters-long!!';
    expect(result).toBeNull();
  });
});
