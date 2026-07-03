import { describe, it, expect } from 'vitest';
import { isLocalPath, safeRedirect } from './safeRedirect';

describe('isLocalPath', () => {
  it('accepts same-origin local paths', () => {
    expect(isLocalPath('/')).toBe(true);
    expect(isLocalPath('/app/dashboard')).toBe(true);
    expect(isLocalPath('/browse?addMemory=abc')).toBe(true);
  });

  it('rejects open-redirect vectors', () => {
    expect(isLocalPath('https://evil.example/phish')).toBe(false);
    expect(isLocalPath('//evil.example')).toBe(false); // protocol-relative
    expect(isLocalPath('/\\evil.example')).toBe(false); // backslash → // in some browsers
    expect(isLocalPath('javascript:alert(1)')).toBe(false);
    expect(isLocalPath('app/dashboard')).toBe(false); // no leading slash
  });

  it('rejects nullish/empty', () => {
    expect(isLocalPath(null)).toBe(false);
    expect(isLocalPath(undefined)).toBe(false);
    expect(isLocalPath('')).toBe(false);
  });
});

describe('safeRedirect', () => {
  it('passes through safe local paths', () => {
    expect(safeRedirect('/app/memories/new')).toBe('/app/memories/new');
  });

  it('falls back for unsafe or missing targets', () => {
    expect(safeRedirect('https://evil.example')).toBe('/app/dashboard');
    expect(safeRedirect('//evil.example')).toBe('/app/dashboard');
    expect(safeRedirect(null)).toBe('/app/dashboard');
    expect(safeRedirect('/x', '/home')).toBe('/x');
    expect(safeRedirect('https://evil', '/home')).toBe('/home');
  });
});
