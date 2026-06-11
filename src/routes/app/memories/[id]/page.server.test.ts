/**
 * #266: the memory-detail index has no content — it redirects to the default
 * (Info) tab. Pin that behavior so a future tab reshuffle can't silently change
 * the landing tab.
 */
import { describe, it, expect } from 'vitest';
import { load } from './+page.server';

describe('memory-detail index redirect', () => {
  it('redirects to the /info tab (307)', () => {
    let thrown: unknown;
    try {
      // load is synchronous — redirect() throws.
      (load as (e: { params: { id: string } }) => unknown)({ params: { id: 'mem-x' } });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeDefined();
    expect((thrown as { status: number }).status).toBe(307);
    expect((thrown as { location: string }).location).toBe('/app/memories/mem-x/info');
  });
});
