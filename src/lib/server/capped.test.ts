import { describe, expect, it } from 'vitest';
import { isCapped } from './capped';

describe('isCapped (#1226)', () => {
  it('a full window may have more behind it; a short one is complete', () => {
    expect(isCapped(500, 500)).toBe(true);
    expect(isCapped(499, 500)).toBe(false);
    expect(isCapped(0, 500)).toBe(false);
  });
});
