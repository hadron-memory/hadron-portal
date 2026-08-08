import { describe, expect, it } from 'vitest';
import { buildNavItems } from './nav';

const hrefs = (data: Parameters<typeof buildNavItems>[0]) => buildNavItems(data).map((i) => i.href);
const memoriesHref = (data: Parameters<typeof buildNavItems>[0]) =>
  buildNavItems(data).find((i) => i.href.endsWith('/memories') || i.href === '/app/memories')?.href;
// Dashboard is always the first item.
const dashboardHref = (data: Parameters<typeof buildNavItems>[0]) => buildNavItems(data)[0]?.href;

describe('buildNavItems', () => {
  it('#629: EVERY user\'s Dashboard points at /app/dashboard (not the org page)', () => {
    expect(dashboardHref({ activeOrgId: 'personal-1', isConsumerMode: true })).toBe('/app/dashboard');
    expect(dashboardHref({ activeOrgId: null, isConsumerMode: false })).toBe('/app/dashboard');
    expect(dashboardHref({ activeOrgId: 'org-1', isConsumerMode: false })).toBe('/app/dashboard');
  });

  it('Marketplace is hidden from the nav for now', () => {
    for (const data of [
      { activeOrgId: 'org-1', isConsumerMode: false },
      { activeOrgId: 'personal-1', isConsumerMode: true },
      { activeOrgId: null, isConsumerMode: false },
    ]) {
      expect(hrefs(data)).not.toContain('/app/marketplace');
    }
  });

  it('#628: an individual (consumer) user\'s Memories points at the org-less surface', () => {
    expect(memoriesHref({ activeOrgId: 'personal-1', isConsumerMode: true })).toBe('/app/memories');
    // Never sends individuals into their personal org's memories grid.
    expect(hrefs({ activeOrgId: 'personal-1', isConsumerMode: true })).not.toContain(
      '/app/orgs/personal-1/memories',
    );
  });

  it('an org member keeps the direct org-scoped memories grid AND gets a personal "My memories" link', () => {
    const items = hrefs({ activeOrgId: 'org-1', isConsumerMode: false });
    // The org grid ("Memories") comes first…
    expect(memoriesHref({ activeOrgId: 'org-1', isConsumerMode: false })).toBe('/app/orgs/org-1/memories');
    // …and their personal (org-less) memories are reachable via "My memories".
    expect(items).toContain('/app/memories');
  });

  it('#647: consumer nav includes org-less Agents (/app/agents) and Apps (/app/apps)', () => {
    const items = hrefs({ activeOrgId: 'personal-1', isConsumerMode: true });
    expect(items).toEqual([
      '/app/dashboard',
      '/app/search',
      '/app/memories',
      '/app/agents',
      '/app/apps',
      '/app/orgs/personal-1/runs',
      // Task Nodes then Files, below the whole Apps group.
      '/app/orgs/personal-1/tasks',
      '/app/assets',
    ]);
    // …never the org-scoped variants for an individual.
    expect(items).not.toContain('/app/orgs/personal-1/agents');
    expect(items).not.toContain('/app/orgs/personal-1/apps');
  });

  it('full (org) nav includes Agents and Apps', () => {
    const items = hrefs({ activeOrgId: 'org-1', isConsumerMode: false });
    expect(items).toContain('/app/orgs/org-1/agents');
    expect(items).toContain('/app/orgs/org-1/apps');
    // Dashboard, Search, Memories (org), My memories, Files, Task Nodes,
    // Agents, Apps, App Runs.
    expect(items).toHaveLength(9);
  });

  it('App Runs sits directly below Apps and needs an active org', () => {
    // Org member: Apps is the org-scoped link.
    const orgItems = hrefs({ activeOrgId: 'org-1', isConsumerMode: false });
    expect(orgItems.indexOf('/app/orgs/org-1/runs')).toBe(orgItems.indexOf('/app/orgs/org-1/apps') + 1);
    // Consumer: Apps is the org-LESS link, and App Runs still follows it.
    const consumerItems = hrefs({ activeOrgId: 'personal-1', isConsumerMode: true });
    expect(consumerItems.indexOf('/app/orgs/personal-1/runs')).toBe(consumerItems.indexOf('/app/apps') + 1);
    // Still org-gated: no active org, no App Runs.
    expect(hrefs({ activeOrgId: null, isConsumerMode: false })).not.toContain('/app/orgs/null/runs');
  });

  it('without an active org, still shows the org-independent items (so no empty sidebar)', () => {
    // #628 review (Copilot): an org-less user must be able to reach /app/memories;
    // only the truly org-scoped items (Task Nodes / App Runs / Agents / Apps) drop out.
    const items = hrefs({ activeOrgId: null, isConsumerMode: false });
    // Files is org-independent too: its default "My files" slice is the caller's
    // own uploads, and the Organization slice degrades to an explanatory empty
    // state rather than needing an org to render.
    expect(items).toEqual(['/app/dashboard', '/app/search', '/app/memories', '/app/assets']);
    expect(items.some((h) => h.startsWith('/app/orgs/'))).toBe(false);
  });

  it('puts Task Nodes then Files below the whole Apps group', () => {
    // The ordering is a maintainer's call, so pin it rather than let a future
    // insertion quietly reshuffle it. App Runs stays the Apps section's tail
    // (asserted above), and these two sit after it.
    const items = hrefs({ activeOrgId: 'org-1', isConsumerMode: false });
    expect(items.slice(-2)).toEqual(['/app/orgs/org-1/tasks', '/app/assets']);
    expect(items.indexOf('/app/orgs/org-1/tasks')).toBeGreaterThan(
      items.indexOf('/app/orgs/org-1/runs'),
    );
  });

  it('a consumer with no active org still gets the org-less Memories link', () => {
    expect(memoriesHref({ activeOrgId: undefined, isConsumerMode: true })).toBe('/app/memories');
  });
});
