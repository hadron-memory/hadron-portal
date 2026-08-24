/**
 * #266: the memory-detail index has no content — it redirects to the default
 * (Info) tab. Pin that behavior so a future tab reshuffle can't silently change
 * the landing tab.
 *
 * #761: and it must carry the incoming query string. A memory URN resolved
 * through /app/u/[urn] lands on /app/memories/<id> and is redirected AGAIN by
 * this loader, so a deep link's state has to survive TWO hops. Fixing only the
 * resolver left the memory kind — alone among the seven resolved kinds — still
 * silently losing its query here, on a page that looks like it worked.
 */
import { describe, it, expect } from 'vitest';
import { load } from './+page.server';

type IndexEvent = { params: { id: string }; url: URL };

/** Run the (synchronous) loader and capture the thrown redirect. */
function expectRedirect(id: string, search = ''): { status: number; location: string } {
  let thrown: unknown;
  try {
    (load as (e: IndexEvent) => unknown)({
      params: { id },
      url: new URL(`http://localhost/app/memories/${id}${search}`),
    });
  } catch (e) {
    thrown = e;
  }
  expect(thrown).toBeDefined();
  return thrown as { status: number; location: string };
}

describe('memory-detail index redirect', () => {
  it('redirects to the /info tab (307)', () => {
    const r = expectRedirect('mem-x');
    expect(r.status).toBe(307);
    expect(r.location).toBe('/app/memories/mem-x/info');
  });

  it('appends nothing when there is no incoming query', () => {
    // Guards the other direction: a plain visit must not gain a bare '?'.
    expect(expectRedirect('mem-x', '').location).not.toContain('?');
  });

  // The #761 case: the SECOND hop of a memory-URN deep link.
  it('carries the query string onto the Info tab', () => {
    const r = expectRedirect('mem-x', '?highlight=findings:foo&view=tree');
    expect(r.status).toBe(307);
    expect(r.location).toBe('/app/memories/mem-x/info?highlight=findings:foo&view=tree');
  });
});
