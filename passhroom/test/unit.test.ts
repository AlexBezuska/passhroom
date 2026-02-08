import { describe, expect, it } from 'vitest';
import { normalizeEmail } from '../src/lib/users';
import { sha256Base64Url } from '../src/lib/crypto';
import { redirectUriAllowed } from '../src/lib/clients';

describe('email normalization', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Foo@Example.COM ')).toBe('foo@example.com');
  });
});

describe('hashing', () => {
  it('hash is stable', () => {
    expect(sha256Base64Url('abc')).toBe(sha256Base64Url('abc'));
  });
});

describe('redirect allowlist', () => {
  it('requires exact match', () => {
    const client: any = { redirect_uris: ['https://a.example/cb'] };
    expect(redirectUriAllowed(client, 'https://a.example/cb')).toBe(true);
    expect(redirectUriAllowed(client, 'https://a.example/cb/')).toBe(false);
  });
});
