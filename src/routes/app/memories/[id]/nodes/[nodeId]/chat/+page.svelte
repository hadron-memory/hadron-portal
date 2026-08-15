<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import ChatThread from '$lib/components/ChatThread.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import type { MemoryNode } from '$lib/types';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  const node = $derived(data?.node);
  const messages = $derived(data?.messages ?? []);
  const basePath = $derived(data?.graph?.id ? `/app/memories/${data.graph.id}` : '');
  const memoriesHref = $derived(data?.org?.id ? `/app/orgs/${data.org.id}/memories` : undefined);

  // Build breadcrumb from node loc segments
  const breadcrumbItems = $derived.by(() => {
    if (!data?.graph?.name || !node?.name || !basePath) return [];

    const items: { label: string; href?: string }[] = [
      { label: 'Memories', href: memoriesHref },
      { label: data.graph.name, href: basePath },
      { label: 'Nodes', href: `${basePath}/nodes` },
    ];

    // Add clickable parent nodes from the loc hierarchy
    const parts = node.loc?.split(':') ?? [];
    for (let i = 1; i < parts.length; i++) {
      const parentLoc = parts.slice(0, i).join(':');
      const parentNode = ((data.graphNodes ?? []) as MemoryNode[]).find((n: MemoryNode) => n.loc === parentLoc);
      if (parentNode) {
        items.push({
          label: parentNode.name,
          href: `${basePath}/nodes/${parentNode.id}`,
        });
      }
    }

    // Add the chat node itself (clickable to detail page)
    items.push({
      label: node.name,
      href: `${basePath}/nodes/${node.id}`,
    });

    // Add the chat view (not clickable)
    items.push({ label: 'Chat' });

    return items;
  });

  let reloading = $state(false);
  async function reloadChat() {
    reloading = true;
    try {
      await invalidateAll();
    } catch (err) {
      console.error('Failed to reload chat:', err);
    } finally {
      reloading = false;
    }
  }
</script>

<svelte:head>
  <title>{node.name} · Team Chat · Hadron</title>
</svelte:head>

<div class="flex flex-col h-screen bg-white dark:bg-zinc-950">
  <!-- Header -->
  <div class="border-b border-zinc-200 dark:border-zinc-800 px-6 py-4">
    <Breadcrumb items={breadcrumbItems} />
    <div class="mt-4 flex items-start justify-between">
      <div>
        <h1 class="text-2xl font-bold text-zinc-900 dark:text-white">{node.name}</h1>
        <Urn value={data.fullUrn} type="node" />
      </div>
      <div class="flex gap-2">
        <button
          onclick={reloadChat}
          disabled={reloading}
          class="rounded-md bg-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-300 disabled:opacity-50 dark:bg-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-600"
          title="Reload messages"
        >
          {#if reloading}
            <svg class="inline w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M23 4v6h-6"></path>
              <path d="M1 20v-6h6"></path>
              <path d="M3.51 9a9 9 0 0114.85-3.36M20.49 15a9 9 0 01-14.85 3.36"></path>
            </svg>
            Reloading...
          {:else}
            ↻ Reload
          {/if}
        </button>
        <!-- ?tab=content: the node page opens on its Chat tab for a chat node,
             which would make this link look like a no-op. -->
        <a
          href="{basePath}/nodes/{node.id}?tab=content"
          class="rounded-md bg-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-300 dark:bg-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-600"
        >
          View node details →
        </a>
      </div>
    </div>
  </div>

  <ChatThread
    {messages}
    {basePath}
    {form}
    memoryUrn={data.graph?.urn ?? null}
    sendForm={data.form}
    action="?/sendMessage"
    canPost={!!node.memory?.appId || node.tags?.includes('team-chat')}
  />
</div>
