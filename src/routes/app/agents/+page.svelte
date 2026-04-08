<script lang="ts">
  import Urn from '$lib/components/Urn.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  let search = $state('');

  // Flatten agents from all orgs
  const allAgents = $derived.by(() => {
    const agents: Array<{ id: string; urn: string; name: string; description: string | null; visibility: string; orgId: string; orgName: string; orgUrn: string; memoryCount: number; isPong?: boolean; href?: string; mailboxEmail?: string }> = [];

    // Add Pong agent cards for each Exchange connection
    for (const conn of data.exchangeConnections ?? []) {
      agents.push({
        id: `pong-${conn.id}`,
        urn: `pong:${conn.mailboxEmail}`,
        name: 'Pong',
        description: `Email assistant for ${conn.mailboxEmail} — drafts replies using your knowledge base`,
        visibility: 'PRIVATE',
        orgId: '',
        orgName: conn.displayName ?? conn.mailboxEmail,
        orgUrn: '',
        memoryCount: 0,
        isPong: true,
        href: `/app/account/exchange/${conn.id}`,
        mailboxEmail: conn.mailboxEmail,
      });
    }

    for (const org of data.orgs) {
      for (const agent of org.agents ?? []) {
        agents.push({
          id: agent.id,
          urn: agent.urn,
          name: agent.name,
          description: agent.description,
          visibility: agent.visibility ?? 'PRIVATE',
          orgId: org.id,
          orgName: org.name,
          orgUrn: org.urn,
          memoryCount: agent.memoryItems?.length ?? 0,
        });
      }
    }
    return agents;
  });

  const filtered = $derived(
    allAgents.filter((a) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return a.name.toLowerCase().includes(q) ||
        a.urn.toLowerCase().includes(q) ||
        (a.description ?? '').toLowerCase().includes(q) ||
        a.orgName.toLowerCase().includes(q);
    })
  );
</script>

<svelte:head><title>Agents · Hadron</title></svelte:head>

<div class="space-y-6">
  <div>
    <h1 class="text-2xl font-bold text-zinc-900 dark:text-white">Agents</h1>
    <p class="mt-1 text-sm text-zinc-500">All agents across your organizations.</p>
  </div>

  {#if allAgents.length > 0}
    <div>
      <input
        type="text"
        placeholder="Search agents..."
        bind:value={search}
        class="w-full max-w-md rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500"
      />
    </div>
  {/if}

  {#if allAgents.length === 0}
    <div class="rounded-xl border border-zinc-200 bg-white p-12 text-center text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
      No agents yet. Create one from an organization's Agents page.
    </div>
  {:else if filtered.length === 0}
    <div class="rounded-xl border border-zinc-200 bg-white p-12 text-center text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
      No agents match "{search}".
    </div>
  {:else}
    <div class="space-y-3">
      {#each filtered as agent (agent.id)}
        <a
          href={agent.isPong ? agent.href : `/app/agents/${agent.id}`}
          class="flex items-center gap-4 rounded-xl border p-5 transition {agent.isPong
            ? 'border-emerald-200 bg-emerald-50 hover:border-emerald-400 dark:border-emerald-800 dark:bg-emerald-950 dark:hover:border-emerald-600'
            : 'border-zinc-200 bg-white hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600'}"
        >
          {#if agent.isPong}
            <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-100 dark:bg-emerald-900/50">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-emerald-600 dark:text-emerald-400"><rect width="20" height="16" x="2" y="4" rx="2"></rect><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"></path></svg>
            </div>
          {/if}
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <p class="text-sm font-semibold {agent.isPong ? 'text-emerald-700 dark:text-emerald-300' : 'text-indigo-600 dark:text-indigo-300'}">{agent.name}</p>
              {#if agent.isPong}
                <span class="rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">email agent</span>
              {/if}
            </div>
            <p class="font-mono text-xs text-zinc-400">{agent.urn}</p>
            {#if agent.description}
              <p class="mt-1 text-xs text-zinc-500">{agent.description}</p>
            {/if}
            <div class="mt-1 flex items-center gap-2 text-xs text-zinc-400">
              {#if agent.isPong}
                <span>{agent.mailboxEmail}</span>
              {:else}
                <span>{agent.orgName} · {agent.memoryCount} memor{agent.memoryCount !== 1 ? 'ies' : 'y'}</span>
              {/if}
              {#if !agent.isPong}
                {#if agent.visibility === 'PUBLIC'}
                  <span class="rounded bg-blue-100 px-2 py-0.5 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">public</span>
                {:else if agent.visibility === 'ORGANIZATION'}
                  <span class="rounded bg-amber-100 px-2 py-0.5 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">organization</span>
                {:else}
                  <span class="rounded bg-zinc-100 px-2 py-0.5 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">private</span>
                {/if}
              {/if}
            </div>
          </div>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="shrink-0 text-zinc-400"><polyline points="9 18 15 12 9 6"></polyline></svg>
        </a>
      {/each}
    </div>
  {/if}
</div>
