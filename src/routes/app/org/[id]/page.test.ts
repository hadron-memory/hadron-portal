import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Page from './+page.svelte';

function page(overrides: Record<string, unknown> = {}) {
  const organization = {
    id: 'org-1',
    name: 'Public <script> Org',
    urn: 'hrn:org:public.test',
    listedOnMarketplace: true,
    publicMemoriesPage: {
      items: Array.from({ length: 20 }, (_, index) => ({
        id: `mem-${index + 1}`,
        name: index === 0 ? 'Public Docs' : `Public Memory ${index + 1}`,
        urn: index === 0 ? 'hrn:mem:public.test:docs' : `hrn:mem:public.test:docs-${index + 1}`,
        description: index === 0 ? 'Public documentation' : null,
      })),
      total: 21,
      hasMore: true,
    },
    publicAgentsPage: {
      items: Array.from({ length: 20 }, (_, index) => ({
        id: `agent-${index + 1}`,
        name: index === 0 ? 'Public Helper' : `Public Agent ${index + 1}`,
        urn: index === 0 ? 'hrn:agent:public.test:helper' : `hrn:agent:public.test:helper-${index + 1}`,
        description: index === 0 ? 'Answers questions' : null,
      })),
      total: 205,
      hasMore: true,
    },
    // Deliberately illegal extras: even if a caller supplies them, the page has
    // no member/admin surface on which they could appear.
    members: [{ user: { name: 'Private Member' } }],
    apps: [{ name: 'Private App' }],
    billing: { customerId: 'private-billing-id' },
    ...overrides,
  };
  return render(Page as never, {
    props: {
      data: {
        organization,
        paging: { memories: { limit: 20, offset: 0 }, agents: { limit: 20, offset: 0 } },
        path: '/app/org/org-1',
        search: '?from=memory&agentsOffset=0',
      },
    } as never,
  }).body;
}

describe('/app/org/[id] public organization page (#1846 slice B)', () => {
  it('renders the sanitized identity, truthful totals, and linked public resources', () => {
    const body = page();
    expect(body).toContain('Public &lt;script> Org');
    expect(body).not.toContain('Public <script> Org');
    expect(body).toContain('hrn:org:public.test');
    expect(body).toContain('Listed in the marketplace');
    expect(body).toContain('Public memories (21)');
    expect(body).toContain('Public agents (205)');
    expect(body).toContain('Public Docs');
    expect(body).toContain('Public documentation');
    expect(body).toContain('Public Helper');
    expect(body).toContain('Answers questions');
    expect(body).toContain('href="/app/u/hrn:mem:public.test:docs"');
    expect(body).toContain('href="/app/u/hrn:agent:public.test:helper"');
    expect(body.match(/<table/g)).toHaveLength(2);
    expect(body).toContain('Showing 1–20 of 21');
    expect(body).toContain('Showing 1–20 of 205');
  });

  it('uses native independent GET links and preserves unrelated and other-kind parameters', () => {
    const body = page();
    expect(body).toContain('href="/app/org/org-1?from=memory&amp;agentsOffset=0&amp;memoriesOffset=20"');
    expect(body).toContain('href="/app/org/org-1?from=memory&amp;agentsOffset=20"');
    expect(body).not.toContain('Search public memories');
    expect(body).not.toContain('Rows per page');
    expect(body).not.toContain('aria-sort=');
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
      publicMemoriesPage: {
        items: [{ id: 'bad', name: 'Bad', urn: 'hrn:mem:public.test:../../../settings/tokens', description: null }],
        total: 1,
        hasMore: false,
      },
    });
    expect(body).toContain('href="/app/u/hrn:mem:public.test:..%2F..%2F..%2Fsettings%2Ftokens"');
    expect(body).not.toContain('href="/app/u/hrn:mem:public.test:../../../settings/tokens"');
    expect(body).not.toContain('aria-label="Copy Bad URL"');
  });

  it('renders explicit zero-total empty states instead of invented resources or paging controls', () => {
    const body = page({
      publicMemoriesPage: { items: [], total: 0, hasMore: false },
      publicAgentsPage: { items: [], total: 0, hasMore: false },
      listedOnMarketplace: false,
    });
    expect(body).toContain('data-testid="public-memories-empty"');
    expect(body).toContain('data-testid="public-agents-empty"');
    expect(body).toContain('Public memories (0)');
    expect(body).toContain('Public agents (0)');
    expect(body).toContain('No public memories yet');
    expect(body).toContain('No public agents yet');
    expect(body).not.toContain('Listed in the marketplace');
    expect(body).not.toContain('rel="next"');
    expect(body).not.toContain('rel="prev"');
    expect(body).not.toContain('rel="first"');
  });

  it('treats an offset past the end as a recoverable empty page with truthful total, First and Previous', () => {
    const body = render(Page as never, {
      props: {
        data: {
          organization: {
            id: 'org-1', name: 'Public Org', urn: 'hrn:org:public.test', listedOnMarketplace: false,
            publicMemoriesPage: { items: [], total: 45, hasMore: false },
            publicAgentsPage: { items: [], total: 0, hasMore: false },
          },
          paging: { memories: { limit: 500, offset: 500 }, agents: { limit: 20, offset: 0 } },
          path: '/app/org/org-1',
          search: '?from=memory&memoriesLimit=500&memoriesOffset=500',
        },
      } as never,
    }).body;
    expect(body).toContain('This page is empty');
    expect(body).toContain('45 public memories in all');
    expect(body).not.toContain('No public memories yet');
    expect(body).toContain('rel="first"');
    expect(body).toContain('rel="prev"');
    expect(body).toContain('memoriesLimit=500&amp;memoriesOffset=300');
    expect(body).not.toContain('memoriesOffset=0"');
  });
});
