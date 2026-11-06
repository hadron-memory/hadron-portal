/**
 * #636 → #788: /app/dashboard/customize is retired — editing happens in place
 * on /app/dashboard. The route only 301s old links/bookmarks there.
 */
import { describe, expect, it } from 'vitest';
import { load } from './+page.server';

describe('/app/dashboard/customize (retired)', () => {
  it('permanently redirects to the dashboard', async () => {
    // #1732: the load awaits the parent layout first, so the redirect is a rejection.
    await expect(
      load({ parent: async () => ({}) } as unknown as Parameters<typeof load>[0]),
    ).rejects.toMatchObject({ status: 301, location: '/app/dashboard' });
  });
});
