<script lang="ts">
  // #327 + follow-up: Account is a tab layout. The breadcrumb + heading + tab bar
  // live here; each tab is a sub-route rendered via {@render children()}:
  //   Account      → /app/account               (profile, sign out)
  //   Organization → /app/account/organizations  (memberships / create org)
  //   Invite       → /app/account/invite         (invite a user)
  //   API Keys     → /app/account/api-keys        (API keys)
  import { page } from '$app/stores';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import { t } from '$lib/i18n/t';

  let { children }: { children: import('svelte').Snippet } = $props();

  const tabs = [
    { id: 'account', label: t('app.account.tab.account', 'Account'), href: '/app/account' },
    { id: 'organization', label: t('app.account.tab.organization', 'Organization'), href: '/app/account/organizations' },
    { id: 'invite', label: t('app.account.tab.invite', 'Invite'), href: '/app/account/invite' },
    { id: 'api-keys', label: t('app.account.tab.api-keys', 'API Keys'), href: '/app/account/api-keys' },
  ];
  const activeTab = $derived(
    $page.url.pathname.startsWith('/app/account/api-keys')
      ? 'api-keys'
      : $page.url.pathname.startsWith('/app/account/organizations')
        ? 'organization'
        : $page.url.pathname.startsWith('/app/account/invite')
          ? 'invite'
          : 'account',
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
  <div class="flex gap-0 overflow-x-auto border-b border-zinc-200 dark:border-zinc-800">
    {#each tabs as tab (tab.id)}
      <a
        href={tab.href}
        class="shrink-0 whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium transition
          {activeTab === tab.id
            ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
            : 'border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-200'}"
      >{tab.label}</a>
    {/each}
  </div>

  {@render children()}
</div>
