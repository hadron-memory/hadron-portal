import { describe, expect, it } from 'vitest';
import { parseThemePreference, readStoredTheme, resolveDark, writeStoredTheme } from './theme';

describe('theme preference (#419)', () => {
  it('keeps the old meaning of the stored value: only light, and now system, change it', () => {
    expect(parseThemePreference('light')).toBe('light');
    expect(parseThemePreference('dark')).toBe('dark');
    expect(parseThemePreference('system')).toBe('system');
    // Nothing stored, or an unknown value, was dark before and still is.
    expect(parseThemePreference(null)).toBe('dark');
    expect(parseThemePreference(undefined)).toBe('dark');
    expect(parseThemePreference('sepia')).toBe('dark');
  });

  it('resolves System from the OS and the others from themselves', () => {
    expect(resolveDark('system', true)).toBe(true);
    expect(resolveDark('system', false)).toBe(false);
    expect(resolveDark('dark', false)).toBe(true);
    expect(resolveDark('light', true)).toBe(false);
  });

  it('survives storage that throws or is absent', () => {
    const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(readStoredTheme(blocked)).toBe('dark');
    expect(() => writeStoredTheme(blocked, 'light')).not.toThrow();
    expect(readStoredTheme(undefined)).toBe('dark');
    expect(() => writeStoredTheme(undefined, 'light')).not.toThrow();
  });

  it('round-trips through storage under the existing key', () => {
    const data = new Map<string, string>();
    const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
    writeStoredTheme(storage, 'system');
    expect(data.get('theme')).toBe('system');
    expect(readStoredTheme(storage)).toBe('system');
  });
});
