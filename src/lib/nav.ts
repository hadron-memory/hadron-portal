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
 * Consumer (individual) users get a trimmed list (no Agents/Apps). #628: their
 * "Memories" points at the org-less `/app/memories` surface (#632) rather than
 * `/app/orgs/<personalOrgId>/memories`, which sent individuals into their
 * invisible personal org. Org members keep the org-scoped grid (a direct link,
 * no redirect hop). The whole list is gated on an active org (unchanged).
 */
export function buildNavItems(data: {
  activeOrgId?: string | null;
  isConsumerMode?: boolean;
}): NavItem[] {
  const { activeOrgId, isConsumerMode } = data;
  if (!activeOrgId) return [];

  const base: NavItem[] = [
    { href: `/app/orgs/${activeOrgId}`, label: t('app.nav.dashboard', 'Dashboard'), match: 'exact' },
    { href: '/app/search', label: t('app.nav.search', 'Search'), match: 'prefix' },
    { href: '/app/marketplace', label: t('app.nav.marketplace', 'Marketplace'), match: 'prefix' },
    {
      href: isConsumerMode ? '/app/memories' : `/app/orgs/${activeOrgId}/memories`,
      label: t('app.nav.memories', 'Memories'),
      match: 'prefix',
    },
    { href: `/app/orgs/${activeOrgId}/tasks`, label: t('app.nav.task-nodes', 'Task Nodes'), match: 'prefix' },
  ];

  if (isConsumerMode) return base;

  return [
    ...base,
    { href: `/app/orgs/${activeOrgId}/agents`, label: t('app.nav.agents', 'Agents'), match: 'prefix' },
    { href: `/app/orgs/${activeOrgId}/apps`, label: t('app.nav.apps', 'Apps'), match: 'prefix' },
  ];
}
