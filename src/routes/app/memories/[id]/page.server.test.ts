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

type IndexEvent = { params: { id: string }; url: URL; parent: () => Promise<unknown> };

/** Run the loader (parent resolved) and capture the redirect it rejects with. */
async function expectRedirect(id: string, search = ''): Promise<{ status: number; location: string }> {
  let thrown: unknown;
  try {
    await (load as (e: IndexEvent) => unknown)({
      params: { id },
      url: new URL(`http://localhost/app/memories/${id}${search}`),
      parent: async () => ({}),
    });
  } catch (e) {
    thrown = e;
  }
  // A load that never reaches the throw must fail here, not pass vacuously.
  expect(thrown).toBeDefined();
  return thrown as { status: number; location: string };
}

describe('memory-detail index redirect', () => {
  it('redirects to the /info tab (307)', async () => {
    const r = await expectRedirect('mem-x');
    expect(r.status).toBe(307);
    expect(r.location).toBe('/app/memories/mem-x/info');
  });

  it('appends nothing when there is no incoming query', async () => {
    // Guards the other direction: a plain visit must not gain a bare '?'.
    expect((await expectRedirect('mem-x', '')).location).not.toContain('?');
  });

  // The #761 case: the SECOND hop of a memory-URN deep link.
  it('carries the query string onto the Info tab', async () => {
    const r = await expectRedirect('mem-x', '?highlight=findings:foo&view=tree');
    expect(r.status).toBe(307);
    expect(r.location).toBe('/app/memories/mem-x/info?highlight=findings:foo&view=tree');
  });

  // #1394: the app layout writes the active-org cookie AFTER its GraphQL awaits.
  // SvelteKit runs layout and page loads in parallel, so a redirect that settles
  // first lets the response be generated and the later `cookies.set` is
  // rejected. The redirect must wait for the parent (layout) load.
  // Defensive change on a static lead: the root cause is unconfirmed.
  it('does not redirect until the parent layout load has resolved (#1394)', async () => {
    let release!: () => void;
    const parent = new Promise<unknown>((resolve) => { release = () => resolve({}); });
    let settled: 'pending' | 'rejected' | 'resolved' = 'pending';
    let error: unknown;
    const run = Promise.resolve((load as (e: IndexEvent) => unknown)({
      params: { id: 'mem-x' },
      url: new URL('http://localhost/app/memories/mem-x?view=tree'),
      parent: () => parent,
    })).then(() => { settled = 'resolved'; }, (e) => { settled = 'rejected'; error = e; });
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(settled).toBe('pending');
    release();
    await run;
    expect(settled).toBe('rejected');
    expect(error).toMatchObject({ status: 307, location: '/app/memories/mem-x/info?view=tree' });
  });
});
