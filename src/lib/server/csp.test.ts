/**
 * #700 — runtime CSP augmentation for the object-store origin. Verifies the
 * connect-src append leaves every other directive (incl. nonces) untouched,
 * is idempotent, and that unset/invalid config resolves to null WITH a loud
 * console.error (silent omission is the failure mode that motivated #700).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { appendConnectSrc, appendPublicServerFormAction, publicOrigin, resolveAssetStorageOrigin } from './csp';

// Shaped like the header SvelteKit emits for svelte.config.js's directives.
const HEADER =
  "default-src 'self'; script-src 'self' 'nonce-abc123'; style-src 'self' 'unsafe-inline'; " +
  "connect-src 'self' https://srv.hadronmemory.com; object-src 'none'; base-uri 'self'; " +
  "frame-ancestors 'none'; form-action 'self'";

describe('appendConnectSrc', () => {
  it('appends the origin to connect-src and nothing else', () => {
    const patched = appendConnectSrc(HEADER, 'https://nbg1.your-objectstorage.com');
    expect(patched).toContain(
      "connect-src 'self' https://srv.hadronmemory.com https://nbg1.your-objectstorage.com"
    );
    // Every other directive is untouched, including the script-src nonce.
    expect(patched).toContain("script-src 'self' 'nonce-abc123'");
    expect(patched).toContain("frame-ancestors 'none'");
    expect(patched.split(';')).toHaveLength(HEADER.split(';').length);
  });

  it('is idempotent when the origin is already listed', () => {
    const once = appendConnectSrc(HEADER, 'https://nbg1.your-objectstorage.com');
    expect(appendConnectSrc(once, 'https://nbg1.your-objectstorage.com')).toBe(once);
  });

  it('leaves a header without a connect-src directive unchanged', () => {
    const header = "default-src 'self'; object-src 'none'";
    expect(appendConnectSrc(header, 'https://store.example.test')).toBe(header);
  });
});

describe('resolveAssetStorageOrigin', () => {
  afterEach(() => vi.restoreAllMocks());

  it('normalizes a URL with a path/trailing slash to the bare origin', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(resolveAssetStorageOrigin('https://nbg1.your-objectstorage.com/bucket/')).toBe(
      'https://nbg1.your-objectstorage.com'
    );
    expect(console.error).not.toHaveBeenCalled();
  });

  it('returns null and logs loudly when unset', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(resolveAssetStorageOrigin(undefined)).toBeNull();
    expect(resolveAssetStorageOrigin('')).toBeNull();
    expect(error).toHaveBeenCalledTimes(2);
    expect(error.mock.calls[0][0]).toContain('PUBLIC_ASSET_STORAGE_ORIGIN is not set');
  });

  it('returns null and logs loudly on an unparseable URL', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(resolveAssetStorageOrigin('not a url')).toBeNull();
    expect(error).toHaveBeenCalledOnce();
    expect(error.mock.calls[0][0]).toContain('not a valid URL');
  });
});

// #2430: the asset origin goes through the same host allowlist as #2425's form-action source.
const DISALLOWED_HOSTS = [
  'https://a;script-src.example',
  'https://a,b.example',
  "https://a'b.example",
  'https://a%3Bscript-src.example',
  'https://a%2Cb.example',
  'https://a%27b.example',
  'https://[::1;x]',
  'https://fixture:fixture@store.example.test',
  'javascript:alert(1)',
  'ftp://store.example.test',
];
const ADMITTED = [
  'https://store.example.test',
  'https://store.example.test:9000',
  'http://localhost:9000',
  'https://[::1]:9000',
  'https://nbg1.your-objectstorage.com',
];

describe('#2430 asset origin host allowlist', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(DISALLOWED_HOSTS)('resolveAssetStorageOrigin leaves out %s and logs once, without the raw value', (raw) => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(resolveAssetStorageOrigin(raw)).toBeNull();
    expect(error).toHaveBeenCalledOnce();
    expect(String(error.mock.calls[0][0])).toContain('PUBLIC_ASSET_STORAGE_ORIGIN');
    expect(String(error.mock.calls[0][0])).not.toContain('script-src');
  });

  it.each(DISALLOWED_HOSTS)('appendConnectSrc never splices %s, called directly', (raw) => {
    expect(appendConnectSrc(HEADER, raw)).toBe(HEADER);
    // The serialized origin keeps a hostile host (but drops credentials, which are then harmless).
    let origin: string | null = null;
    try {
      const u = new URL(raw);
      if (!u.username) origin = u.origin;
    } catch { /* unparseable: the raw string was the whole test */ }
    if (origin !== null) expect(appendConnectSrc(HEADER, origin)).toBe(HEADER);
  });

  it.each(ADMITTED)('a valid origin %s is unchanged by the allowlist and is spliced', (raw) => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const origin = resolveAssetStorageOrigin(`${raw}/bucket/`);
    expect(origin).toBe(new URL(raw).origin);
    expect(error).not.toHaveBeenCalled();
    expect(appendConnectSrc(HEADER, origin!)).toContain(`connect-src 'self' https://srv.hadronmemory.com ${origin};`);
  });

  it('both splices use the one helper: connect-src and form-action admit and refuse the same origins', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const raw of [...DISALLOWED_HOSTS, ...ADMITTED]) {
      const viaHelper = publicOrigin(raw);
      expect(resolveAssetStorageOrigin(raw), raw).toBe(viaHelper);
      expect(appendPublicServerFormAction(HEADER, raw) !== HEADER, raw).toBe(viaHelper !== null);
      expect(appendConnectSrc(HEADER, viaHelper ?? raw) !== HEADER, raw).toBe(viaHelper !== null);
    }
  });
});
