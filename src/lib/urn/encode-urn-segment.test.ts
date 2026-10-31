/**
 * #1512: the URN in a `/app/u/<urn>` href is ONE path segment. A target such as
 * `hrn:node:a:b:../../../settings/tokens` must not let the browser resolve out
 * of `/app/u/`, and the resolver must still receive the original URN back.
 */
import { describe, expect, it } from 'vitest';
import { encodeUrnPathSegment } from './encode-urn-segment';

const BASE = 'http://portal.test/app/team-chat';
const resolve = (segment: string) => new URL(`/app/u/${segment}`, BASE);

describe('encodeUrnPathSegment (#1512)', () => {
  it('leaves a normal v2 or v1 URN byte-identical', () => {
    for (const urn of [
      'hrn:node:hadronmemory.com:hadron-portal:findings:some-finding',
      'hrn:node:hadronmemory.com::hadron-portal::findings:x',
    ]) {
      expect(encodeUrnPathSegment(urn)).toBe(urn);
    }
  });

  it.each([
    ['slash', '/', '%2F'],
    ['question mark', '?', '%3F'],
    ['hash', '#', '%23'],
    ['percent', '%', '%25'],
    ['backslash (browsers read it as a slash)', '\\', '%5C'],
  ])('encodes a %s', (_n, ch, enc) => {
    expect(encodeUrnPathSegment(`hrn:node:a:b:x${ch}y`)).toBe(`hrn:node:a:b:x${enc}y`);
  });

  it.each([
    ['dot-dot traversal', 'hrn:node:a:b:../../../settings/tokens'],
    ['backslash traversal', 'hrn:node:a:b:..\\..\\..\\settings\\tokens'],
    ['query smuggle', 'hrn:node:a:b:x?next=/app/settings'],
    ['fragment smuggle', 'hrn:node:a:b:x#/app/settings'],
    ['tab/newline the URL parser would strip', 'hrn:node:a:b:x\t.\n./y'],
  ])('%s stays one segment under /app/u/', (_n, urn) => {
    const u = resolve(encodeUrnPathSegment(urn));
    expect(u.search).toBe('');
    expect(u.hash).toBe('');
    expect(u.pathname.startsWith('/app/u/')).toBe(true);
    // exactly one segment after /app/u/
    expect(u.pathname.slice('/app/u/'.length)).not.toMatch(/\//);
  });

  it('round-trips: the framework decodes the segment back to the original URN', () => {
    for (const urn of ['hrn:node:a:b:../../x', 'hrn:node:a:b:50%25?#\\', 'hrn:node:a:b:x\ty\nz w']) {
      const seg = encodeUrnPathSegment(urn);
      // through the URL parser first, as the browser does, then the router decode
      const path = new URL(`/app/u/${seg}`, BASE).pathname.slice('/app/u/'.length);
      expect(decodeURIComponent(path)).toBe(urn);
    }
  });
});
