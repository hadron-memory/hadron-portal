/**
 * #700 — runtime CSP augmentation for the object-store origin. Verifies the
 * connect-src append leaves every other directive (incl. nonces) untouched,
 * is idempotent, and that unset/invalid config resolves to null WITH a loud
 * console.error (silent omission is the failure mode that motivated #700).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { appendConnectSrc, resolveAssetStorageOrigin } from './csp';

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
