import { beforeEach, describe, expect, it } from 'vitest';
import { env } from '$env/dynamic/public';
import { ceremonyOrigin, parseCeremonyOrigin, pinCeremonyUrl } from './ceremony-origin';

describe('ceremony origin (portal#2417)', () => {
  beforeEach(() => { delete env.PUBLIC_SERVER_URL; });
  it('is read from PUBLIC_SERVER_URL with no default: unset is no origin, never localhost', () => {
    expect(ceremonyOrigin()).toBeNull();
    env.PUBLIC_SERVER_URL = 'https://hadron.example/some/path';
    expect(ceremonyOrigin()).toBe('https://hadron.example');
  });
  it('refuses anything that is not a bare http(s) origin', () => {
    for (const raw of [undefined, null, '', 'hadron.example', 'ftp://h.example', 'javascript:1', 'https://u:p@h.example']) expect(parseCeremonyOrigin(raw)).toBeNull();
  });
  it('pins by exact origin; the prefix is optional', () => {
    expect(pinCeremonyUrl('https://h.example/a', 'https://h.example')).toBe('https://h.example/a');
    expect(pinCeremonyUrl('https://h.example/a', 'https://h.example', '/b/')).toBeNull();
    expect(pinCeremonyUrl(42, 'https://h.example')).toBeNull();
    expect(pinCeremonyUrl('https://h.example/' + 'x'.repeat(2100), 'https://h.example')).toBeNull();
  });
});
