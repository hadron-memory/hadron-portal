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
 * Org-independent items (Search, Marketplace, and — for individuals — the
 * org-less Memories surface) show even without an active org, so an org-less
 * user is never stranded with an empty sidebar (Copilot review on #628; matters
 * more as #627 removes the personal org). Org-scoped items (Dashboard, Task
 * Nodes, Agents, Apps) only appear when there's an active org, and Agents/Apps
 * only for non-consumer (org) members.
 *
 * #628: a consumer (individual) user's "Memories" points at the org-less
 * `/app/memories` surface (#632) rather than `/app/orgs/<personalOrgId>/memories`,
 * which sent individuals into their invisible personal org. Org members keep the
 * direct org-scoped grid (no redirect hop).
 */
export function buildNavItems(data: {
  activeOrgId?: string | null;
  isConsumerMode?: boolean;
}): NavItem[] {
  const { activeOrgId, isConsumerMode } = data;
  const items: NavItem[] = [];

  // Dashboard is org-scoped (its target is the org page) — only with an org.
  if (activeOrgId) {
    items.push({ href: `/app/orgs/${activeOrgId}`, label: t('app.nav.dashboard', 'Dashboard'), match: 'exact' });
  }

  items.push({ href: '/app/search', label: t('app.nav.search', 'Search'), match: 'prefix' });
  items.push({ href: '/app/marketplace', label: t('app.nav.marketplace', 'Marketplace'), match: 'prefix' });

  // Individuals (consumer mode) and org-less users → the org-less My-memories
  // surface; org members → their org's grid.
  items.push({
    href: isConsumerMode || !activeOrgId ? '/app/memories' : `/app/orgs/${activeOrgId}/memories`,
    label: t('app.nav.memories', 'Memories'),
    match: 'prefix',
  });

  if (activeOrgId) {
    items.push({ href: `/app/orgs/${activeOrgId}/tasks`, label: t('app.nav.task-nodes', 'Task Nodes'), match: 'prefix' });
  }

  if (activeOrgId && !isConsumerMode) {
    items.push({ href: `/app/orgs/${activeOrgId}/agents`, label: t('app.nav.agents', 'Agents'), match: 'prefix' });
    items.push({ href: `/app/orgs/${activeOrgId}/apps`, label: t('app.nav.apps', 'Apps'), match: 'prefix' });
  }

  return items;
}
