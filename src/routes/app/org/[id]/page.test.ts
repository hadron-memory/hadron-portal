import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Page from './+page.svelte';

function page(overrides: Record<string, unknown> = {}) {
  const organization = {
    id: 'org-1',
    name: 'Public <script> Org',
    urn: 'hrn:org:public.test',
    listedOnMarketplace: true,
    publicMemories: [
      { id: 'mem-1', name: 'Public Docs', urn: 'hrn:mem:public.test:docs', description: 'Public documentation' },
    ],
    publicAgents: [
      { id: 'agent-1', name: 'Public Helper', urn: 'hrn:agent:public.test:helper', description: 'Answers questions' },
    ],
    // Deliberately illegal extras: even if a caller supplies them, the page has
    // no member/admin surface on which they could appear.
    members: [{ user: { name: 'Private Member' } }],
    apps: [{ name: 'Private App' }],
    billing: { customerId: 'private-billing-id' },
    ...overrides,
  };
  return render(Page as never, { props: { data: { organization } } as never }).body;
}

describe('/app/org/[id] public organization page (#1846 slice B)', () => {
  it('renders the sanitized identity, marketplace state, and linked public resources', () => {
    const body = page();
    expect(body).toContain('Public &lt;script> Org');
    expect(body).not.toContain('Public <script> Org');
    expect(body).toContain('hrn:org:public.test');
    expect(body).toContain('Listed in the marketplace');
    expect(body).toContain('Public memories (1)');
    expect(body).toContain('Public agents (1)');
    expect(body).toContain('Public Docs');
    expect(body).toContain('Public documentation');
    expect(body).toContain('Public Helper');
    expect(body).toContain('Answers questions');
    expect(body).toContain('href="/app/u/hrn:mem:public.test:docs"');
    expect(body).toContain('href="/app/u/hrn:agent:public.test:helper"');
    expect(body.match(/<table/g)).toHaveLength(2);
  });

  it('has no member, settings, private App, billing, or credential surface', () => {
    const body = page();
    for (const secret of ['Private Member', 'Private App', 'private-billing-id']) {
      expect(body).not.toContain(secret);
    }
    for (const affordance of ['Settings', 'Billing', 'Credentials', 'Invite member']) {
      expect(body).not.toContain(affordance);
    }
  });

  it('encodes public resource links into one resolver segment and offers no raw Copy URL for a malformed URN', () => {
    const body = page({
      publicMemories: [{ id: 'bad', name: 'Bad', urn: 'hrn:mem:public.test:../../../settings/tokens', description: null }],
    });
    expect(body).toContain('href="/app/u/hrn:mem:public.test:..%2F..%2F..%2Fsettings%2Ftokens"');
    expect(body).not.toContain('href="/app/u/hrn:mem:public.test:../../../settings/tokens"');
    expect(body).not.toContain('aria-label="Copy Bad URL"');
  });

  it('renders explicit empty states instead of invented resources', () => {
    const body = page({ publicMemories: [], publicAgents: [], listedOnMarketplace: false });
    expect(body).toContain('data-testid="public-memories-empty"');
    expect(body).toContain('data-testid="public-agents-empty"');
    expect(body).toContain('Public memories (0)');
    expect(body).toContain('Public agents (0)');
    expect(body).toContain('No public memories yet');
    expect(body).toContain('No public agents yet');
    expect(body).not.toContain('Listed in the marketplace');
    expect(body).not.toContain('href="/app/u/hrn:mem:public.test:docs"');
    expect(body).not.toContain('href="/app/u/hrn:agent:public.test:helper"');
  });
});
