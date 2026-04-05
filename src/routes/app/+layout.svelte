<script lang="ts">
  import type { LayoutData } from './$types';
  import { page } from '$app/stores';
  let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();

  const consumerNav = [
    { href: '/app/dashboard', label: 'Dashboard' },
    { href: '/app/my-memories', label: 'Memories' },
  ];

  const fullNav = [
    { href: '/app/dashboard', label: 'Dashboard' },
    { href: '/app/my-memories', label: 'Memories' },
    { href: '/app/agents', label: 'Agents' },
    { href: '/app/stations', label: 'Stations' },
  ];

  const usageNav = [
    { href: '/app/usage/sessions', label: 'Sessions' },
    { href: '/app/usage/memory', label: 'Memory' },
  ];

  const navItems = $derived(data.isConsumerMode ? consumerNav : fullNav);

  // Visible orgs for the nav (hide if only a personal org with isVisible: false/null)
  const visibleOrgs = $derived((data.orgs ?? []).filter((o) => o.isVisible));
  const showOrgSection = $derived(visibleOrgs.length > 0);

  let menuOpen = $state(true);
</script>

<div class="flex gap-8 px-6 py-8">
  <!-- Sidebar -->
  {#if menuOpen}
    <aside class="flex w-48 shrink-0 flex-col" style="min-height: calc(100vh - 8rem);">
      <div class="mb-4 flex items-center justify-end">
        <button onclick={() => menuOpen = false} class="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300" title="Collapse menu">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
      </div>
      <nav class="flex flex-col gap-1">
      {#each navItems as item}
        <a
          href={item.href}
          class="rounded-md px-3 py-2 text-sm transition
            {$page.url.pathname.startsWith(item.href)
              ? 'bg-zinc-100 font-medium text-zinc-900 dark:bg-zinc-800 dark:text-white'
              : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-white'}"
        >
          {item.label}
        </a>
      {/each}
      {#if !data.isConsumerMode}
        <hr class="my-2 border-zinc-200 dark:border-zinc-800" />
        <span class="px-3 py-1 text-xs font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-600">Usage</span>
        {#each usageNav as item}
          <a
            href={item.href}
            class="rounded-md px-3 py-2 text-sm transition
              {$page.url.pathname.startsWith(item.href)
                ? 'bg-zinc-100 font-medium text-zinc-900 dark:bg-zinc-800 dark:text-white'
                : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-white'}"
          >
            {item.label}
          </a>
        {/each}
      {/if}
      {#if showOrgSection}
        <hr class="my-2 border-zinc-200 dark:border-zinc-800" />
        <span class="px-3 py-1 text-xs font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-600">Organizations</span>
        {#each visibleOrgs as org}
          <a
            href="/app/orgs/{org.id}"
            class="rounded-md px-3 py-2 text-sm transition truncate
              {$page.url.pathname.startsWith(`/app/orgs/${org.id}`)
                ? 'bg-zinc-100 font-medium text-zinc-900 dark:bg-zinc-800 dark:text-white'
                : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-white'}"
          >
            {org.name}
          </a>
        {/each}
      {/if}
    </nav>
      <!-- User avatar + name pinned to bottom -->
      <div class="mt-auto pt-4">
        <hr class="mb-3 border-zinc-200 dark:border-zinc-800" />
        <a href="/app/account" class="flex items-center gap-2 rounded-md px-3 py-2 text-sm transition
          {$page.url.pathname.startsWith('/app/account')
            ? 'bg-zinc-100 font-medium text-zinc-900 dark:bg-zinc-800 dark:text-white'
            : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-white'}">
          {#if data.user.avatarUrl}
            <img src={data.user.avatarUrl} alt={data.user.name ?? data.user.githubUsername ?? data.user.email ?? ''} class="h-6 w-6 rounded-full" />
          {/if}
          <span class="truncate">{data.user.name ?? data.user.githubUsername ?? data.user.email}</span>
        </a>
      </div>
  </aside>
  {:else}
    <button
      onclick={() => menuOpen = true}
      class="self-start rounded-md border border-zinc-200 p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:border-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
      title="Expand menu"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
    </button>
  {/if}

  <!-- Content -->
  <div class="min-w-0 flex-1">
    {@render children()}
  </div>
</div>
