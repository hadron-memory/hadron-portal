/**
 * #1062 — a user with no organization can open the organizations list.
 *
 * Runs the REAL `$lib/server/guards` (no mock): putting `requireNonConsumer`
 * back on this load fails here. That guard redirects consumer mode (a member of
 * zero organizations, i.e. every new user) to My memories, so "View
 * organizations" landed them on a page about something else without a word.
 * Same fault as #1028 on the create form.
 */
import { describe, expect, it, vi } from 'vitest';
import { fetchAllItems } from '$lib/server/paginate';

const request = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request }) }));
vi.mock('$lib/server/paginate', () => ({ fetchAllItems: vi.fn(async () => []) }));

import { load } from './+page.server';

function event(parentData: Record<string, unknown>) {
  return { locals: { token: 't' }, parent: vi.fn().mockResolvedValue(parentData) } as never;
}

describe('organizations list — load (#1062)', () => {
  it('opens (with an empty list) for a user with no organization', async () => {
    await expect(load(event({ isConsumerMode: true, activeOrgId: null }))).resolves.toEqual({ orgs: [] });
  });

  it('opens for an org member too', async () => {
    await expect(load(event({ isConsumerMode: false, activeOrgId: 'org-1' }))).resolves.toEqual({ orgs: [] });
  });

  // The two cases above mock an empty list; this pins that the load passes the
  // server's organizations through untouched, so dropping the guard cannot hide
  // a regression in what a member sees.
  it('returns the organizations the server lists for a member', async () => {
    const orgs = [{ id: 'org-1', urn: 'hrn:org:acme.com' }, { id: 'org-2', urn: 'hrn:org:globex.com' }];
    vi.mocked(fetchAllItems).mockResolvedValueOnce(orgs as never);
    await expect(load(event({ isConsumerMode: false, activeOrgId: 'org-1' }))).resolves.toEqual({ orgs });
  });
});
