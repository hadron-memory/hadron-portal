<script lang="ts">
  import { enhance } from '$app/forms';
  import CopyUrn from '$lib/components/CopyUrn.svelte';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import MemoryBrowser from '$lib/components/MemoryBrowser.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  const agent = $derived(data.agent);
  const org = $derived(data.org);
  const writableMemoryIds = $derived((agent.memoryItems ?? []).filter((m) => m.role === 'read-write').map((m) => m.memory.id));

  type TabId = 'memory' | 'settings';
  let activeTab = $state<TabId>('memory');
  const tabs: { id: TabId; label: string }[] = [
    { id: 'memory', label: 'Memory' },
    { id: 'settings', label: 'Settings' },
  ];
</script>

<svelte:head><title>{agent.name} · Hadron</title></svelte:head>

<div class="space-y-4">
  <!-- Breadcrumb -->
  <Breadcrumb items={[
    { label: 'Dashboard', href: '/app/dashboard' },
    { label: 'Agents', href: '/app/agents' },
    { label: agent.name },
  ]} />

  <!-- Header -->
  <div class="flex items-center gap-3">
    <h1 class="text-2xl font-bold text-zinc-900 dark:text-white">{agent.name}</h1>
    <CopyUrn value={agent.urn} />
  </div>
  {#if agent.description}
    <p class="text-sm text-zinc-500">{agent.description}</p>
  {/if}
  <p class="text-xs text-zinc-400">Organization: {org.name}</p>

  <!-- Tabs -->
  <div class="flex gap-0 border-b border-zinc-200 dark:border-zinc-800">
    {#each tabs as tab}
      <button
        onclick={() => activeTab = tab.id}
        class="border-b-2 px-4 py-2 text-sm font-medium transition
          {activeTab === tab.id
            ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
            : 'border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-200'}"
      >
        {tab.label}
      </button>
    {/each}
  </div>

  <!-- ═══════════════════════════════════════════════════════════════════ -->
  <!-- MEMORY TAB                                                        -->
  <!-- ═══════════════════════════════════════════════════════════════════ -->
  {#if activeTab === 'memory'}
    <MemoryBrowser nodes={data.agentNodes ?? []} multiMemory={(agent.memoryItems ?? []).length > 1} {writableMemoryIds} />
  {/if}

  <!-- ═══════════════════════════════════════════════════════════════════ -->
  <!-- SETTINGS TAB                                                      -->
  <!-- ═══════════════════════════════════════════════════════════════════ -->
  {#if activeTab === 'settings'}
    <div class="max-w-lg space-y-8">
      <!-- Properties -->
      {#if agent.properties}
        <section>
          <h2 class="mb-3 font-semibold text-zinc-900 dark:text-white">Properties</h2>
          <pre class="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-xs text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 overflow-x-auto">{JSON.stringify(agent.properties, null, 2)}</pre>
        </section>
      {/if}

      <!-- Memories -->
      <section>
        <h2 class="mb-3 font-semibold text-zinc-900 dark:text-white">Memories
          <span class="ml-1 text-sm font-normal text-zinc-500">({(agent.memoryItems ?? []).length})</span>
        </h2>
        {#if (agent.memoryItems ?? []).length > 0}
          <div class="divide-y divide-zinc-200 rounded-xl border border-zinc-200 overflow-hidden dark:divide-zinc-800 dark:border-zinc-800">
            {#each agent.memoryItems ?? [] as item (item.id)}
              <div class="flex items-center gap-4 bg-white px-5 py-3 dark:bg-zinc-900">
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-medium text-zinc-900 dark:text-zinc-200">{item.memory.name}</p>
                  <CopyUrn value={item.memory.urn} size={10} />
                </div>
                <span class="shrink-0 rounded-full px-2 py-0.5 text-xs {item.role === 'read-write' ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300'}">{item.role}</span>
              </div>
            {/each}
          </div>
        {:else}
          <p class="text-sm text-zinc-500">No memories in this agent.</p>
        {/if}
      </section>

      <!-- Details -->
      <section class="grid gap-3 text-sm sm:grid-cols-2">
        <div class="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <p class="text-xs text-zinc-500">Organization</p>
          <p class="mt-1 font-medium text-zinc-900 dark:text-white">{org.name}</p>
        </div>
        <div class="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <p class="text-xs text-zinc-500">Created</p>
          <p class="mt-1 text-zinc-900 dark:text-white">{new Date(agent.createdAt).toLocaleDateString()}</p>
        </div>
      </section>
    </div>
  {/if}
</div>
