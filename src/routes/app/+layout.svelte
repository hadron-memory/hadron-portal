<script lang="ts">
  import type { LayoutData } from './$types';
  import { page } from '$app/stores';

  let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();

  const navItems = [
    { href: '/app/dashboard', label: 'Dashboard' },
    { href: '/app/orgs', label: 'Organizations' },
    { href: '/app/clients', label: 'Clients' },
  ];
</script>

<div class="mx-auto flex max-w-7xl gap-8 px-4 py-8">
  <!-- Sidebar -->
  <aside class="w-48 shrink-0">
    <div class="mb-4 flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
      {#if data.user.avatarUrl}
        <img src={data.user.avatarUrl} alt={data.user.githubUsername} class="h-6 w-6 rounded-full" />
      {/if}
      <span class="truncate font-medium text-zinc-700 dark:text-zinc-200">{data.user.name ?? data.user.githubUsername}</span>
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
    </nav>
  </aside>

  <!-- Content -->
  <div class="min-w-0 flex-1">
    {@render children()}
  </div>
</div>
