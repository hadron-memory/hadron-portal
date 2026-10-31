<script lang="ts">
  import { untrack } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import ChatThread from '$lib/components/ChatThread.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import { t } from '$lib/i18n/t.js';
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

    // portal#1524: no ancestor crumbs. They were looked up in the memory
    // layout's node list, which is no longer loaded; a missing crumb withholds
    // a link rather than asserting the parent does not exist.

    // Add the chat node itself (clickable to detail page)
    items.push({
      label: node.name,
      href: `${basePath}/nodes/${node.id}`,
    });

    // Add the chat view (not clickable)
    items.push({ label: 'Chat' });

    return items;
  });


  // #793: fetch the page BEFORE the loaded window. The route owns HOW to read
  // (an isolated endpoint, so a scroll-up cannot re-run the page's fatal load
  // paths — #785's rule); ChatThread owns WHEN and the scroll anchoring.
  //
  // `chatOffset` walks backwards: each page returns the offset it started at,
  // which is the cursor for the one before it. Returning NULL on failure is
  // load-bearing — the component treats null as "retry on the next scroll" and
  // an empty array as "start of the conversation", so collapsing them would
  // permanently end the scrollback on one transient error.
  // A `$state` INITIALIZER runs once. Re-syncing on page data is not optional
  // (@codex on PR #797): a reload or a post replaces `data.messages`, which
  // makes ChatThread drop its accumulated older rows — so a cursor left at the
  // deeper offset would make the next scroll ask for history BEFORE it and skip
  // everything between there and the refreshed tail. The node-detail surface
  // already did this; the two must not drift, since a reader moves between them
  // with the "Full-screen chat" button.
  let olderCursor = $state<number>(0);
  $effect(() => {
    const o = data.chatOffset ?? 0;
    untrack(() => { olderCursor = o; });
  });
  async function loadOlderChat() {
    const res = await fetch(`${basePath}/nodes/${node.id}/chat-older?before=${olderCursor}`);
    if (!res.ok) return null;
    const body = await res.json();
    if (body.loadFailed) return null;
    olderCursor = body.offset;
    return { messages: body.messages, hasOlder: body.hasOlder ?? false };
  }

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
        <!--
          #489 part 4. Mirrors the node page's header deliberately: this is the
          surface a reader STAYS on, and it is one click from there, so the App
          reference must survive the hop. Same shape (name + URN + link) so the
          two headers read as one place, not two.
        -->
        {#if data.chatApp}
          <div class="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <span class="text-zinc-500 dark:text-zinc-400">{t('node.chat.app-label', 'App')}</span>
            <a
              href="/app/apps/{data.chatApp.id}"
              class="font-medium text-blue-600 hover:underline dark:text-blue-400"
            >{data.chatApp.name}</a>
            <Urn value={data.chatApp.urn} type="app" size={10} />
          </div>
        {/if}
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
    canPost={data.canPost}
    hasOlder={data.hasOlder ?? false}
    onLoadOlder={loadOlderChat}
  />
</div>
