import { describe, it, expect } from 'vitest';
import { deriveDefaultUrn } from './derive-default-urn.js';

describe('deriveDefaultUrn', () => {
  it('returns the base when no collision exists', () => {
    expect(deriveDefaultUrn('org:micromentor.org', 'mmcoding-agent', [])).toBe(
      'org:micromentor.org:mmcoding-agent',
    );
  });

  it('returns the base when existing URNs do not collide', () => {
    expect(
      deriveDefaultUrn('org:micromentor.org', 'mmcoding-agent', [
        'org:micromentor.org:other-app',
        'org:other-org:mmcoding-agent',
      ]),
    ).toBe('org:micromentor.org:mmcoding-agent');
  });

  it('suffixes -2 on a single collision', () => {
    expect(
      deriveDefaultUrn('org:micromentor.org', 'mmcoding-agent', [
        'org:micromentor.org:mmcoding-agent',
      ]),
    ).toBe('org:micromentor.org:mmcoding-agent-2');
  });

  it('suffixes -3 when -2 also collides', () => {
    expect(
      deriveDefaultUrn('org:micromentor.org', 'mmcoding-agent', [
        'org:micromentor.org:mmcoding-agent',
        'org:micromentor.org:mmcoding-agent-2',
      ]),
    ).toBe('org:micromentor.org:mmcoding-agent-3');
  });

  it('suffixes the lowest free number, not strictly sequential', () => {
    expect(
      deriveDefaultUrn('org:micromentor.org', 'mmcoding-agent', [
        'org:micromentor.org:mmcoding-agent',
        'org:micromentor.org:mmcoding-agent-2',
        // -3 is free
        'org:micromentor.org:mmcoding-agent-4',
      ]),
    ).toBe('org:micromentor.org:mmcoding-agent-3');
  });
});
