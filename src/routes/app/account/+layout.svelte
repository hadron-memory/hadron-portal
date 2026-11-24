<script lang="ts">
  import TabRow from '$lib/components/TabRow.svelte';
  // #327 + follow-up: Account is a tab layout. The breadcrumb + heading + tab bar
  // live here; each tab is a sub-route rendered via {@render children()}:
  //   Account      → /app/account               (profile, sign out)
  //   Organization → /app/account/organizations  (memberships / create org)
  //   Invite       → /app/account/invite         (invite a user)
  //   API Keys     → /app/account/api-keys        (API keys)
  //   Grants       → /app/account/grants          (own grants across Apps, #2134)
  import { page } from '$app/stores';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import { t } from '$lib/i18n/t';
  import { extensionAccountNavTabs } from '$lib/ext/registry';
  import { tabIsActive } from '$lib/ext/tab-match';

  let { children }: { children: import('svelte').Snippet } = $props();

  const tabs = [
    { id: 'account', label: t('app.account.tab.account', 'Account'), href: '/app/account' },
    { id: 'organization', label: t('app.account.tab.organization', 'Organization'), href: '/app/account/organizations' },
    { id: 'node-role-templates', label: t('config.templates', 'Node-role templates'), href: '/app/account/node-role-templates' },
    { id: 'invite', label: t('app.account.tab.invite', 'Invite'), href: '/app/account/invite' },
    { id: 'api-keys', label: t('app.account.tab.api-keys', 'API Keys'), href: '/app/account/api-keys' },
    { id: 'grants', label: t('app.account.tab.grants', 'Grants'), href: '/app/account/grants' },
    // C2 (#2568): extension tabs last.
    ...extensionAccountNavTabs({ basePath: '/app/account' }),
  ];
  const activeTab = $derived(
    $page.url.pathname.startsWith('/app/account/node-role-templates')
      ? 'node-role-templates'
      : $page.url.pathname.startsWith('/app/account/grants')
      ? 'grants'
      : $page.url.pathname.startsWith('/app/account/api-keys')
      ? 'api-keys'
      : $page.url.pathname.startsWith('/app/account/organizations')
        ? 'organization'
        : $page.url.pathname.startsWith('/app/account/invite')
          ? 'invite'
          : (tabs.find((tb) => tb.id.startsWith('ext:') && tabIsActive($page.url.pathname, tb))?.id ?? 'account'),
  );
</script>

<div class="space-y-4">
  <div>
    <Breadcrumb items={[
      { label: 'Dashboard', href: '/app/dashboard' },
      { label: 'Account' },
    ]} />
    <h1 class="mt-2 text-2xl font-bold text-zinc-900 dark:text-white">Account</h1>
  </div>

  <!-- #858 — scrolls rather than overflowing. Measured at a 390px viewport:
       these four tabs are 335px in a 308px column, so the page ran 10px off
       the right edge. `shrink-0 whitespace-nowrap` on each tab is the other
       half — without them flex compresses four labels into unreadable columns
       instead of letting the strip scroll (PR #746, item 2). -->
  <TabRow mode="links" items={tabs.map(tab => ({ ...tab, preload: tab.id === 'node-role-templates' ? 'off' as const : undefined }))} active={activeTab} label={t('account.tabs-label', 'Account sections')} />

  {@render children()}
</div>
