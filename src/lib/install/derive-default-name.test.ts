import { describe, it, expect } from 'vitest';
import { deriveDefaultName } from './derive-default-name.js';

describe('deriveDefaultName', () => {
  it('returns the agent name when no collision exists', () => {
    expect(deriveDefaultName('Micromentor Eng', [])).toBe('Micromentor Eng');
  });

  it('returns the agent name when existing names do not collide', () => {
    expect(deriveDefaultName('Micromentor Eng', ['Some Other App'])).toBe(
      'Micromentor Eng',
    );
  });

  it('suffixes (2) on a single collision', () => {
    expect(deriveDefaultName('Micromentor Eng', ['Micromentor Eng'])).toBe(
      'Micromentor Eng (2)',
    );
  });

  it('suffixes (3) when (2) also collides', () => {
    expect(
      deriveDefaultName('Micromentor Eng', [
        'Micromentor Eng',
        'Micromentor Eng (2)',
      ]),
    ).toBe('Micromentor Eng (3)');
  });

  it('returns the lowest free number', () => {
    expect(
      deriveDefaultName('Micromentor Eng', [
        'Micromentor Eng',
        'Micromentor Eng (2)',
        // (3) is free
        'Micromentor Eng (4)',
      ]),
    ).toBe('Micromentor Eng (3)');
  });
});
