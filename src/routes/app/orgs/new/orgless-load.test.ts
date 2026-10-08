/**
 * #1028 — a user with no organization can open the create-organization form.
 *
 * Runs the REAL `$lib/server/guards` (no mock), so putting
 * `requireNonConsumer` back on this load fails here: that guard is exactly what
 * redirected every new user to My memories.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: vi.fn() }) }));

import { load } from './+page.server';

function event(parentData: Record<string, unknown>, url = 'http://localhost/app/orgs/new') {
  return { parent: vi.fn().mockResolvedValue(parentData), url: new URL(url) } as never;
}

describe('create organization — load (#1028)', () => {
  it('opens the form for a user with no organization (consumer mode)', async () => {
    const result = (await load(event({ isConsumerMode: true, activeOrgId: null }))) as {
      form: { data: Record<string, unknown> };
    };
    expect(result.form.data).toMatchObject({ urn: '' });
  });

  it('still prefills the slug from ?urn= for that user', async () => {
    const result = (await load(event({ isConsumerMode: true, activeOrgId: null }, 'http://localhost/app/orgs/new?urn=acme.com'))) as {
      prefillUrn: string;
    };
    expect(result.prefillUrn).toBe('acme.com');
  });

  it('opens the form for an org member too', async () => {
    const result = await load(event({ isConsumerMode: false, activeOrgId: 'org-1' }));
    expect(result).toHaveProperty('form');
  });
});
