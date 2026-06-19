<script lang="ts">
  // #327: Account is a tab layout. The breadcrumb + heading + tab bar live here;
  // each tab is a sub-route rendered via {@render children()}:
  //   Account  → /app/account            (profile, invite, orgs, sign out)
  //   App Keys → /app/account/api-keys    (API keys — moved off the left menu)
  import { page } from '$app/stores';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import { t } from '$lib/i18n/t';

  let { children }: { children: import('svelte').Snippet } = $props();

  const tabs = [
    { id: 'account', label: t('app.account.tab.account', 'Account'), href: '/app/account' },
    { id: 'api-keys', label: t('app.account.tab.api-keys', 'App Keys'), href: '/app/account/api-keys' },
  ];
  const activeTab = $derived(
    $page.url.pathname.startsWith('/app/account/api-keys') ? 'api-keys' : 'account',
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

  <div class="flex gap-0 border-b border-zinc-200 dark:border-zinc-800">
    {#each tabs as tab (tab.id)}
      <a
        href={tab.href}
        class="border-b-2 px-4 py-2 text-sm font-medium transition
          {activeTab === tab.id
            ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
            : 'border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-200'}"
      >{tab.label}</a>
    {/each}
  </div>

  {@render children()}
</div>
