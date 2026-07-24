import { describe, expect, it } from 'vitest';
import { buildNavItems } from './nav';

const hrefs = (data: Parameters<typeof buildNavItems>[0]) => buildNavItems(data).map((i) => i.href);
const memoriesHref = (data: Parameters<typeof buildNavItems>[0]) =>
  buildNavItems(data).find((i) => i.href.endsWith('/memories') || i.href === '/app/memories')?.href;
// Dashboard is always the first item.
const dashboardHref = (data: Parameters<typeof buildNavItems>[0]) => buildNavItems(data)[0]?.href;

describe('buildNavItems', () => {
  it('#629: an individual / org-less user\'s Dashboard points at /app/dashboard', () => {
    expect(dashboardHref({ activeOrgId: 'personal-1', isConsumerMode: true })).toBe('/app/dashboard');
    expect(dashboardHref({ activeOrgId: null, isConsumerMode: false })).toBe('/app/dashboard');
  });

  it('an org member\'s Dashboard points at their org overview', () => {
    expect(dashboardHref({ activeOrgId: 'org-1', isConsumerMode: false })).toBe('/app/orgs/org-1');
  });

  it('#628: an individual (consumer) user\'s Memories points at the org-less surface', () => {
    expect(memoriesHref({ activeOrgId: 'personal-1', isConsumerMode: true })).toBe('/app/memories');
    // Never sends individuals into their personal org's memories grid.
    expect(hrefs({ activeOrgId: 'personal-1', isConsumerMode: true })).not.toContain(
      '/app/orgs/personal-1/memories',
    );
  });

  it('an org member keeps the direct org-scoped memories grid', () => {
    expect(memoriesHref({ activeOrgId: 'org-1', isConsumerMode: false })).toBe('/app/orgs/org-1/memories');
  });

  it('consumer nav is trimmed (no Agents / Apps)', () => {
    const items = hrefs({ activeOrgId: 'personal-1', isConsumerMode: true });
    expect(items).toHaveLength(5);
    expect(items.some((h) => h.endsWith('/agents'))).toBe(false);
    expect(items.some((h) => h.endsWith('/apps'))).toBe(false);
  });

  it('full (org) nav includes Agents and Apps', () => {
    const items = hrefs({ activeOrgId: 'org-1', isConsumerMode: false });
    expect(items).toContain('/app/orgs/org-1/agents');
    expect(items).toContain('/app/orgs/org-1/apps');
    expect(items).toHaveLength(7);
  });

  it('without an active org, still shows the org-independent items (so no empty sidebar)', () => {
    // #628 review (Copilot): an org-less user must be able to reach /app/memories;
    // only the truly org-scoped items (Task Nodes / Agents / Apps) drop out.
    const items = hrefs({ activeOrgId: null, isConsumerMode: false });
    expect(items).toEqual(['/app/dashboard', '/app/search', '/app/marketplace', '/app/memories']);
    expect(items.some((h) => h.startsWith('/app/orgs/'))).toBe(false);
  });

  it('a consumer with no active org still gets the org-less Memories link', () => {
    expect(memoriesHref({ activeOrgId: undefined, isConsumerMode: true })).toBe('/app/memories');
  });
});
