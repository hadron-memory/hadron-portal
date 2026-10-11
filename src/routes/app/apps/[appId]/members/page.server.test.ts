import { describe, expect, it, vi } from 'vitest';
import { actions, load } from './+page.server';

const request = vi.fn().mockResolvedValue({});
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request }) }));

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

describe('old member-form POSTs (step 5 P2)', () => {
  it('run the mutation, then land on the Human Team tab', async () => {
    request.mockClear();
    const body = new FormData();
    body.set('_kind', 'ensureAppMember');
    body.set('userId', 'u2');
    body.set('role', 'reader');
    const event = {
      request: new Request('http://x/members?/ensure', { method: 'POST', body }),
      params: { appId: 'app-1' },
      locals: { token: 't' },
    };
    await expect(actions.ensure(event as never)).rejects.toMatchObject({
      status: 303,
      location: '/app/apps/app-1?tab=members',
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(Object.keys(actions).sort()).toEqual(['add', 'ensure', 'remove']);
  });
});
