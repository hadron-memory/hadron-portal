/**
 * #636 → #788: /app/dashboard/customize is retired — editing happens in place
 * on /app/dashboard. The route only 301s old links/bookmarks there.
 */
import { describe, expect, it } from 'vitest';
import { load } from './+page.server';

describe('/app/dashboard/customize (retired)', () => {
  it('permanently redirects to the dashboard', () => {
    try {
      load({} as Parameters<typeof load>[0]);
      expect.unreachable('load should throw a redirect');
    } catch (e) {
      expect(e).toMatchObject({ status: 301, location: '/app/dashboard' });
    }
  });
});
