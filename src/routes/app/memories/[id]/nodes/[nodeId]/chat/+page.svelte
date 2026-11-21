<script lang="ts">
  import { untrack } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import ChatThread from '$lib/components/ChatThread.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import { Shrink } from 'lucide-svelte';
  import { t } from '$lib/i18n/t.js';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  const node = $derived(data?.node);
  const messages = $derived(data?.messages ?? []);
  const basePath = $derived(data?.graph?.id ? `/app/memories/${data.graph.id}` : '');
  const memoriesHref = $derived(data?.org?.id ? `/app/orgs/${data.org.id}/memories` : undefined);

  // portal#1525: a team CHANNEL reads as a Channel here — caption, icon-only
  // collapse, per-message seq — while agent/other chats keep today's wording
  // on the same route. The loader classified the node (`chatPostTarget`'s
  // platform kind); `=== true` keeps a missing field meaning "not a team
  // channel" for any stale payload.
  const isTeamChannel = $derived(data?.isTeamChannel === true);
  // The caption names what the reader is looking at. An undisclosed App name
  // (chatApp null) degrades to the bare "Team Channel" — never an empty name
  // with a dangling " - " (the same absent-not-empty rule as the App chip).
  const caption = $derived(
    data?.chatApp?.name
      ? t('node.chat.team-channel-caption', '{app} - Team Channel', { app: data.chatApp.name })
      : t('node.chat.team-channel-caption-unnamed', 'Team Channel'),
  );

  // Build breadcrumb from node loc segments
  const breadcrumbItems = $derived.by(() => {
    if (!data?.graph?.name || !node?.name || !basePath) return [];

    const items: { label: string; href?: string }[] = [
      { label: 'Memories', href: memoriesHref },
      { label: data.graph.name, href: basePath },
      { label: 'Nodes', href: `${basePath}/nodes` },
    ];

    // Add clickable parent nodes from the loc hierarchy, looked up by one
    // bounded read in the loader (portal#1433; the layout loads no node list,
    // portal#1524). A missing crumb withholds a link; it asserts nothing.
    const parts = node.loc?.split(':') ?? [];
    for (let i = 1; i < parts.length; i++) {
      const parentLoc = parts.slice(0, i).join(':');
      const parentNode = (data.ancestors ?? []).find((n) => n.loc === parentLoc);
      if (parentNode?.name) {
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

    // Add the chat view (not clickable). portal#1525: a team channel is a
    // Channel; agent/other chats keep "Chat".
    items.push({ label: isTeamChannel ? t('node.chat.channel-crumb', 'Channel') : 'Chat' });

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
  // with the full-screen entry and back (the "Full-screen chat" / "View node
  // details" links on agent/other chats, the icon-only controls on a team
  // Channel — portal#1525).
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
  <!-- portal#1525: the team channel's caption IS its name for a tab/title;
       agent chats keep the node-name form they have always had. -->
  <title>{isTeamChannel ? caption : `${node.name} · Team Chat`} · Hadron</title>
</svelte:head>

<div class="flex flex-col h-screen bg-white dark:bg-zinc-950">
  <!-- Header -->
  <div class="border-b border-zinc-200 dark:border-zinc-800 px-6 py-4">
    <Breadcrumb items={breadcrumbItems} />
    <!-- portal#1525 fix head (UX P2): the row wraps and the title block may
         shrink below its content. Without both, the unbreakable URN chip set
         the block's min-content width and pushed Reload/Collapse past the
         390px viewport edge — the way back this PR adds was off-screen on a
         phone. `min-w-0` on the block is what lets the chip's own internal
         truncation engage; `shrink-0` on the button group keeps it usable
         when they share the row. -->
    <div class="mt-4 flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
      <div class="min-w-0 flex-1">
        <h1 class="break-words text-2xl font-bold text-zinc-900 dark:text-white">{node.name}</h1>
        <Urn value={data.fullUrn} type="node" />
        {#if isTeamChannel}
          <!--
            portal#1525: the team channel's caption. It replaces the App name +
            URN line this header used to carry (#489 part 4): on a Channel the
            caption IS the App reference — "<App> - Team Channel" names both
            halves of what the reader is looking at, so the separate line would
            say the same thing twice. The App still has its own page; the node
            page's inline header keeps the full name + URN reference.
          -->
          <p class="mt-1.5 text-sm text-zinc-500 dark:text-zinc-400">{caption}</p>
        {:else if data.chatApp}
          <!--
            #489 part 4. Mirrors the node page's header deliberately: this is the
            surface a reader STAYS on, and it is one click from there, so the App
            reference must survive the hop. Same shape (name + URN + link) so the
            two headers read as one place, not two.
          -->
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
      <div class="flex shrink-0 gap-2">
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
             which would make this link look like a no-op. portal#1525: a team
             channel drops this control entirely — the Collapse button below is
             the way back, and it returns to the INLINE view (the Chat tab the
             entry opened from), not to node details. Agent/other chats keep
             the link unchanged. -->
        {#if !isTeamChannel}
          <a
            href="{basePath}/nodes/{node.id}?tab=content"
            class="rounded-md bg-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-300 dark:bg-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-600"
          >
            View node details →
          </a>
        {:else}
          <!-- Icon-only, so the accessible name IS the label: an aria-free icon
               link is a mystery to a screen reader and a blank hit target. -->
          <a
            href="{basePath}/nodes/{node.id}?tab=chat"
            aria-label={t('node.chat.collapse', 'Collapse to inline view')}
            title={t('node.chat.collapse', 'Collapse to inline view')}
            class="rounded-md bg-gray-200 p-2 text-gray-700 hover:bg-gray-300 dark:bg-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-600"
          >
            <Shrink class="h-4 w-4" aria-hidden="true" />
          </a>
        {/if}
      </div>
    </div>
  </div>

  <!-- #1522: keyed by the send form's node-scoped id, for the same reason as
       the node page's Chat tab — a same-route hop to another node's chat must
       not leave a live superForm holding the previous node's id (and draft)
       against the new node's results. -->
  {#key data.form.id}
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
      showSeq={isTeamChannel}
      loadFailed={data.chatLoadFailed ?? false}
      onRetry={reloadChat}
    />
  {/key}
</div>
