import { describe, expect, it } from 'vitest';
import { load } from './+page.server';

describe('/app/apps/[appId]/members (#1005)', () => {
  it('forwards to the App page’s Human Team tab', () => {
    try {
      load({ params: { appId: 'app-1' } } as never);
      throw new Error('expected a redirect');
    } catch (e) {
      expect(e).toMatchObject({ status: 307, location: '/app/apps/app-1?tab=members' });
    }
  });
});
