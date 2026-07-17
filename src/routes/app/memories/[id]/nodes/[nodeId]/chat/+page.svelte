<script lang="ts">
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import { onMount, tick } from 'svelte';
  import { marked } from 'marked';
  import DOMPurify from 'dompurify';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import type { MemoryNode } from '$lib/types';

  let { data, form }: { data: any; form: any } = $props();

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

  let input = $state('');
  let sending = $state(false);
  let messagesEl: HTMLDivElement | null = $state(null);
  let error = $state<string | null>(null);
  let hoveredMessageId = $state<string | null>(null);
  let reloading = $state(false);
  let isBrowser = $state(false);

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

  function renderMarkdown(text: string): string {
    // DOMPurify needs a real DOM and cannot run under SSR (invariant P4).
    // Emit nothing until mounted on the client so the {@html} sink is only
    // ever populated with sanitized HTML — never raw attacker-controlled
    // markdown during SSR or the pre-hydration client render.
    if (!isBrowser || !text) return '';
    return DOMPurify.sanitize(marked.parse(text, { async: false }) as string);
  }

  onMount(async () => {
    isBrowser = true;

    await tick();
    if (messagesEl) {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  });

  // Scroll to bottom after new messages arrive
  $effect(() => {
    if (messages) {
      setTimeout(() => {
        if (messagesEl) {
          messagesEl.scrollTop = messagesEl.scrollHeight;
        }
      }, 0);
    }
  });

  // Handle form errors
  $effect(() => {
    if (form?.error) {
      error = form.error;
      setTimeout(() => {
        error = null;
      }, 3000);
    }
  });

  async function handleSubmit() {
    if (!input.trim() || sending) return;

    // Clear input immediately for responsiveness
    const message = input;
    input = '';
  }

  // Handle keyboard submit (Ctrl+Enter or Cmd+Enter)
  function handleKeydown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  }

  // Professional avatar colors for different senders
  function getSenderColor(index: number) {
    const colors = [
      { avatar: 'bg-slate-400 dark:bg-slate-500', avatar_text: 'text-white dark:text-white' },
      { avatar: 'bg-slate-500 dark:bg-slate-600', avatar_text: 'text-white dark:text-white' },
      { avatar: 'bg-slate-600 dark:bg-slate-700', avatar_text: 'text-white dark:text-white' },
      { avatar: 'bg-slate-700 dark:bg-slate-800', avatar_text: 'text-white dark:text-white' },
    ];
    return colors[index % colors.length];
  }

  // Track unique senders for consistent coloring
  const senderIndex: Record<string, number> = {};
  function getSenderColorClass(name: string) {
    if (!(name in senderIndex)) {
      senderIndex[name] = Object.keys(senderIndex).length;
    }
    return getSenderColor(senderIndex[name]);
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
        <a
          href="{basePath}/nodes/{node.id}"
          class="rounded-md bg-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-300 dark:bg-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-600"
        >
          View node details →
        </a>
      </div>
    </div>
  </div>

  <!-- Messages area -->
  <div
    bind:this={messagesEl}
    class="flex-1 overflow-y-auto px-6 py-6 space-y-6 bg-gray-50 dark:bg-zinc-900"
  >
    {#if messages.length === 0}
      <div class="flex items-center justify-center h-full text-center">
        <div>
          <p class="text-zinc-500 dark:text-zinc-400">No messages yet</p>
          <p class="text-sm text-zinc-400 dark:text-zinc-500">Start the conversation!</p>
        </div>
      </div>
    {:else}
      {#each messages as msg, idx (msg.id)}
        {@const color = getSenderColorClass(msg.author ?? 'Unknown')}
        {@const msgUrn = `${data.graph?.urn}::${msg.nodeData?.loc || ''}`}
        <div
          role="group"
          class="flex gap-3 animate-in fade-in slide-in-from-bottom-2 duration-300 group"
          onmouseenter={() => hoveredMessageId = msg.id}
          onmouseleave={() => hoveredMessageId = null}
        >
          <!-- Avatar -->
          <div class="flex-shrink-0 w-8 h-8 rounded-full {color.avatar} flex items-center justify-center flex-shrink-0 mt-1">
            <span class="text-xs font-semibold {color.avatar_text}">
              {(msg.author ?? 'A').charAt(0).toUpperCase()}
            </span>
          </div>

          <!-- Message column -->
          <div class="flex-1">
            <!-- Author and URN on same row, top-aligned -->
            <div class="flex justify-between items-start gap-2 mb-1">
              <div class="text-sm font-semibold text-zinc-900 dark:text-white">
                {msg.author || 'Unknown'}
              </div>
              <a
                href="{basePath}/nodes/{msg.id}"
                class="flex-shrink-0 transition-opacity duration-300 {hoveredMessageId === msg.id ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}"
                title="Go to message node"
              >
                <Urn value={msgUrn} type="node" />
              </a>
            </div>

            <!-- Bubble -->
            <div class="rounded-lg bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 px-4 py-3 text-zinc-900 dark:text-zinc-100 shadow-md">
              <div class="prose prose-sm prose-zinc max-w-none dark:prose-invert [&>*]:my-1 [&>p]:my-1 [&>ul]:my-1 [&>ol]:my-1 [&>blockquote]:my-2">
                {@html renderMarkdown(msg.content)}
              </div>
            </div>

            <!-- Timestamp below bubble, right-aligned -->
            <div class="flex justify-end mt-2">
              <div class="text-xs text-zinc-500">
                {new Date(msg.createdAt).toLocaleTimeString()}
              </div>
            </div>
          </div>
        </div>
      {/each}
    {/if}
  </div>

  <!-- Error banner -->
  {#if error}
    <div class="mx-6 mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
      {error}
    </div>
  {/if}

  <!-- Input area -->
  <div class="border-t border-zinc-200 dark:border-zinc-800 px-6 py-4 bg-zinc-50 dark:bg-zinc-900">
    <form method="POST" action="?/sendMessage" use:enhance={() => {
      sending = true;
      return async ({ update }) => {
        sending = false;
        await invalidateAll();
        input = '';
      };
    }}>
      <div class="flex gap-3">
        <textarea
          name="content"
          bind:value={input}
          placeholder="Type your message... (Ctrl+Enter to send)"
          rows="3"
          disabled={sending}
          onkeydown={handleKeydown}
          class="flex-1 resize-none rounded-lg border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white dark:placeholder-zinc-500"
        ></textarea>
        <button
          type="submit"
          disabled={!input.trim() || sending}
          class="self-end rounded-lg bg-indigo-600 px-4 py-3 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-indigo-500 dark:hover:bg-indigo-600"
        >
          {sending ? 'Sending...' : 'Send'}
        </button>
      </div>
    </form>
  </div>
</div>
