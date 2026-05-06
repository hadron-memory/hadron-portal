import { describe, expect, it } from 'vitest';
import { LocCollisionExhausted, nextAvailableLoc } from './loc-collision';

describe('nextAvailableLoc', () => {
  it('returns the base loc when it is free', () => {
    expect(nextAvailableLoc(new Set(), 'projects/alpha/child')).toBe('projects/alpha/child');
    expect(nextAvailableLoc(new Set(['projects/beta']), 'projects/alpha/child')).toBe(
      'projects/alpha/child',
    );
  });

  it('appends -2 on a single collision', () => {
    expect(nextAvailableLoc(new Set(['a/child']), 'a/child')).toBe('a/child-2');
  });

  it('walks up to -N until a free slot is found', () => {
    const taken = new Set(['a/c', 'a/c-2', 'a/c-3', 'a/c-4']);
    expect(nextAvailableLoc(taken, 'a/c')).toBe('a/c-5');
  });

  it('skips taken intermediate suffixes', () => {
    const taken = new Set(['a/c', 'a/c-3']);
    expect(nextAvailableLoc(taken, 'a/c')).toBe('a/c-2');
  });

  it('throws LocCollisionExhausted after maxAttempts', () => {
    const taken = new Set<string>(['a/c']);
    for (let n = 2; n <= 10; n++) taken.add(`a/c-${n}`);
    expect(() => nextAvailableLoc(taken, 'a/c', 10)).toThrow(LocCollisionExhausted);
  });

  it('exhaustion error carries baseLoc and attempts on the instance', () => {
    const taken = new Set<string>(['a/c']);
    for (let n = 2; n <= 5; n++) taken.add(`a/c-${n}`);
    try {
      nextAvailableLoc(taken, 'a/c', 5);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(LocCollisionExhausted);
      const e = err as LocCollisionExhausted;
      expect(e.baseLoc).toBe('a/c');
      expect(e.attempts).toBe(5);
      expect(e.message).toMatch(/distinctive title/);
    }
  });

  it('uses the default maxAttempts of 99 when not specified', () => {
    const taken = new Set<string>(['a/c']);
    for (let n = 2; n <= 99; n++) taken.add(`a/c-${n}`);
    expect(() => nextAvailableLoc(taken, 'a/c')).toThrow(LocCollisionExhausted);

    // One free slot inside 99 → finds it
    const takenWithGap = new Set<string>(['a/c']);
    for (let n = 2; n <= 99; n++) {
      if (n !== 50) takenWithGap.add(`a/c-${n}`);
    }
    expect(nextAvailableLoc(takenWithGap, 'a/c')).toBe('a/c-50');
  });
});
