import { t } from '$lib/i18n/t';

export interface NavItem {
  href: string;
  label: string;
  match: 'exact' | 'prefix';
}

/**
 * The /app sidebar nav (spec 014). Extracted from +layout.svelte so the routing
 * decisions are unit-testable.
 *
 * Org-independent items (Dashboard, Search, and — for individuals — the org-less
 * Memories surface) show even without an active org, so an org-less user is
 * never stranded with an empty sidebar (Copilot review on #628; matters more as
 * #627 removes the personal org). Task Nodes and App Runs need an active org;
 * Agents and Apps only show for non-consumer (org) members.
 *
 * #629: EVERY user's "Dashboard" now points at /app/dashboard (a stats page) —
 * an org page is the wrong content for a dashboard, individual or not.
 * Marketplace is hidden for now (per maintainer, 2026-07-24) — the route still
 * exists, it's just not linked from the nav.
 * #628: a consumer (individual) user's "Memories" points at the org-less
 * `/app/memories` surface (#632) rather than `/app/orgs/<personalOrgId>/memories`,
 * which sent individuals into their invisible personal org. Org members keep the
 * direct org-scoped grid (no redirect hop).
 * #647: individual (consumer) users also get "Agents" → `/app/agents` and
 * "Apps" → `/app/apps` — the org-less personal surfaces (an individual can own
 * agents/apps directly: Agent/App.ownerUserId, spec 047). Org members keep their
 * org-scoped Agents/Apps. Gated on `isConsumerMode`, NOT merely "no active org":
 * a non-consumer whose active org didn't resolve (activeOrgId null,
 * isConsumerMode false) is an org member mid-resolution, not an individual — they
 * must not get the personal surfaces.
 */
export function buildNavItems(data: {
  activeOrgId?: string | null;
  isConsumerMode?: boolean;
}): NavItem[] {
  const { activeOrgId, isConsumerMode } = data;
  const items: NavItem[] = [];

  // Dashboard (#629): a stats page for everyone, never the org page.
  items.push({ href: '/app/dashboard', label: t('app.nav.dashboard', 'Dashboard'), match: 'exact' });

  items.push({ href: '/app/search', label: t('app.nav.search', 'Search'), match: 'prefix' });
  // Marketplace hidden for now (2026-07-24 maintainer request).

  // Org members get their org's memories grid ("Memories"). EVERYONE also gets
  // "My memories" → the org-less surface listing the personal (user-owned)
  // memories they own directly — so an org member's personal memories aren't
  // stranded (they used to have no route; /app/memories redirected them to the
  // org grid). Consumers/org-less users have only "My memories" (no org grid).
  if (activeOrgId && !isConsumerMode) {
    items.push({ href: `/app/orgs/${activeOrgId}/memories`, label: t('app.nav.memories', 'Memories'), match: 'prefix' });
  }
  items.push({ href: '/app/memories', label: t('app.nav.my-memories', 'My memories'), match: 'prefix' });

  if (activeOrgId) {
    items.push({ href: `/app/orgs/${activeOrgId}/tasks`, label: t('app.nav.task-nodes', 'Task Nodes'), match: 'prefix' });
    // "App Runs" sits next to Task Nodes deliberately: the pair is "what can
    // run" / "what actually ran". Same org gate as Task Nodes — the appRuns
    // audit query is org-scoped (orgRef + org-READER), so it needs an active
    // org but no non-consumer gate.
    items.push({ href: `/app/orgs/${activeOrgId}/runs`, label: t('app.nav.app-runs', 'App Runs'), match: 'prefix' });
  }

  if (activeOrgId && !isConsumerMode) {
    items.push({ href: `/app/orgs/${activeOrgId}/agents`, label: t('app.nav.agents', 'Agents'), match: 'prefix' });
    items.push({ href: `/app/orgs/${activeOrgId}/apps`, label: t('app.nav.apps', 'Apps'), match: 'prefix' });
  } else if (isConsumerMode) {
    // #647: individual users reach their own (org-less) agents/apps here. Same
    // labels as the org items — a consumer has no org list to disambiguate from.
    items.push({ href: '/app/agents', label: t('app.nav.agents', 'Agents'), match: 'prefix' });
    items.push({ href: '/app/apps', label: t('app.nav.apps', 'Apps'), match: 'prefix' });
  }

  return items;
}
