import { describe, expect, it } from 'vitest';
import { buildNavItems } from './nav';

const hrefs = (data: Parameters<typeof buildNavItems>[0]) => buildNavItems(data).map((i) => i.href);
const memoriesHref = (data: Parameters<typeof buildNavItems>[0]) =>
  buildNavItems(data).find((i) => i.href.endsWith('/memories') || i.href === '/app/memories')?.href;

describe('buildNavItems', () => {
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

  it('returns nothing without an active org (unchanged gate)', () => {
    expect(buildNavItems({ activeOrgId: null, isConsumerMode: true })).toEqual([]);
    expect(buildNavItems({ activeOrgId: undefined, isConsumerMode: false })).toEqual([]);
  });
});
