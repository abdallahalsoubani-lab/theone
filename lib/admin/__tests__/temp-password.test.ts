import { describe, expect, it } from 'vitest';

import { generateTempPassword } from '../temp-password';

describe('generateTempPassword', () => {
  it('produces a 12-character string by default', () => {
    const p = generateTempPassword();
    expect(p).toHaveLength(12);
  });

  it('satisfies the password policy (upper, lower, digit, symbol, len ≥ 8)', () => {
    for (let i = 0; i < 20; i++) {
      const p = generateTempPassword();
      expect(p.length).toBeGreaterThanOrEqual(8);
      expect(p).toMatch(/[A-Z]/);
      expect(p).toMatch(/[a-z]/);
      expect(p).toMatch(/\d/);
      expect(p).toMatch(/[!@#$%^&*\-_=+]/);
    }
  });

  it('produces distinct values across calls', () => {
    const set = new Set<string>();
    for (let i = 0; i < 50; i++) set.add(generateTempPassword());
    // 50 random 12-char passwords from this pool should never collide.
    expect(set.size).toBe(50);
  });
});
