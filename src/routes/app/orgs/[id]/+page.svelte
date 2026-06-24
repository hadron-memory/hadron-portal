<script lang="ts">
  // #336: Profile tab of the org-detail tab layout. The org name + URN live in
  // the layout header; this page is the overview — a members preview and
  // subscribed memories. Memories / Agents / Apps / Team / Integrations / Usage
  // each have their own tab now.
  // #364: the Memories/Agents/Apps quick-stat cards were removed — those
  // sections own their tabs (and the count surfaced apps via an overfetch).
  import Urn from '$lib/components/Urn.svelte';
  import { t } from '$lib/i18n/t';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  const org = $derived(data.org);
</script>

<svelte:head><title>{org.name} · Hadron</title></svelte:head>

<div class="space-y-8">
  <!-- Members preview -->
  <section>
    <div class="mb-3 flex items-center justify-between">
      <h2 class="font-semibold text-zinc-900 dark:text-white">{t('org-detail.tab.team', 'Team')} <span class="ml-1 text-sm font-normal text-zinc-500">({org.members?.length ?? 0})</span></h2>
      <a href="/app/orgs/{org.id}/members" class="text-sm text-indigo-600 hover:underline dark:text-indigo-400">Manage →</a>
    </div>
    {#if !org.members?.length}
      <p class="text-sm text-zinc-500">No members yet.</p>
    {:else}
      <div class="flex flex-wrap gap-2">
        {#each org.members.slice(0, 8) as m (m.id)}
          <div class="flex items-center gap-2 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-sm dark:border-zinc-800 dark:bg-zinc-900">
            {#if m.user.avatarUrl}
              <img src={m.user.avatarUrl} alt={m.user.name ?? m.user.githubUsername ?? m.user.email ?? ''} class="h-5 w-5 rounded-full" />
            {/if}
            <span class="text-zinc-700 dark:text-zinc-300">{m.user.name ?? m.user.githubUsername ?? m.user.email}</span>
            {#if m.role === 'OWNER'}
              <span class="rounded-full bg-indigo-100 px-1.5 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300">Owner</span>
            {:else}
              <span class="text-xs text-zinc-500">{m.role}</span>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </section>

  <!-- Subscribed memories -->
  {#if org.subscriptions?.length}
    <section>
      <h2 class="mb-3 font-semibold text-zinc-900 dark:text-white">Subscribed memories <span class="ml-1 text-sm font-normal text-zinc-500">({org.subscriptions.length})</span></h2>
      <div class="grid gap-3 sm:grid-cols-2">
        {#each org.subscriptions as s (s.id)}
          <div class="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <p class="text-sm font-medium text-indigo-600 dark:text-indigo-300">{s.memory.name}</p>
            <Urn value={s.memory.urn} type="memory" size={10} />
            <p class="mt-1 text-xs text-zinc-500">Role: {s.role}</p>
          </div>
        {/each}
      </div>
    </section>
  {/if}
</div>
