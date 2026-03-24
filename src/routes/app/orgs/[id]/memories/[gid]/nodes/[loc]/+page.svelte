<script lang="ts">
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import { onMount } from 'svelte';
  import type { PageData, ActionData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  const node = $derived(data.node);
  const basePath = $derived(`/app/orgs/${data.org.id}/memories/${data.graph.id}`);

  let showSource = $state(false);
  let confirmDelete = $state(false);
  let copied = $state(false);
  let locCopied = $state(false);

  // Markdown rendering (loaded client-side)
  let renderedHtml = $state('');

  onMount(async () => {
    if (node.content) {
      const { Marked } = await import('marked');
      const sanitizedMarked = new Marked({
        renderer: {
          html(token: { text: string }) {
            return token.text
              .replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;');
          },
        },
      });
      renderedHtml = sanitizedMarked.parse(node.content, { async: false }) as string;
    }
  });

  async function copyLoc() {
    try {
      await navigator.clipboard.writeText(node.loc);
      locCopied = true;
      setTimeout(() => (locCopied = false), 2000);
    } catch { /* no-op */ }
  }

  async function copyContent() {
    if (!node.content) return;
    try {
      await navigator.clipboard.writeText(node.content);
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch { /* no-op */ }
  }

  // Children: nodes whose loc is a direct child of this node's loc
  const children = $derived(
    data.graphNodes
      .filter((n) => {
        if (n.loc === node.loc) return false;
        if (!n.loc.startsWith(node.loc + '.')) return false;
        const rest = n.loc.slice(node.loc.length + 1);
        return !rest.includes('.');
      })
      .sort((a, b) => {
        // Sort by seq first (nodes with seq before those without), then by loc
        if (a.seq !== null && b.seq !== null) return a.seq - b.seq;
        if (a.seq !== null) return -1;
        if (b.seq !== null) return 1;
        return a.loc.localeCompare(b.loc);
      })
  );

  const hasChildren = $derived(children.length > 0);
  const hasReferences = $derived(node.outgoingEdges.length > 0 || node.incomingEdges.length > 0);
  const showTabs = $derived(hasChildren || hasReferences);
  let activeTab = $state<'children' | 'references'>('children');

  // ── Child drag-and-drop reordering ──────────────────────────────────────
  const childrenReorderable = $derived(children.some((c) => c.seq !== null));
  let dragChildLoc = $state<string | null>(null);
  let dropChildTarget = $state<{ loc: string; position: 'before' | 'after' } | null>(null);
  let childDragError = $state<string | null>(null);

  function handleChildDragStart(e: DragEvent, loc: string) {
    dragChildLoc = loc;
    childDragError = null;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', loc);
    }
  }

  function handleChildDragOver(e: DragEvent, loc: string) {
    if (!dragChildLoc || dragChildLoc === loc) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = (e.clientY - rect.top) / rect.height;
    dropChildTarget = { loc, position: y < 0.5 ? 'before' : 'after' };
  }

  function handleChildDragLeave(e: DragEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
      dropChildTarget = null;
    }
  }

  async function handleChildDrop(e: DragEvent) {
    e.preventDefault();
    if (!dragChildLoc || !dropChildTarget) { resetChildDrag(); return; }

    const fromLoc = dragChildLoc;
    const { loc: targetLoc, position } = dropChildTarget;
    resetChildDrag();

    // Compute new seq order
    const ordered = [...children];
    const fromIdx = ordered.findIndex((c) => c.loc === fromLoc);
    const toIdx = ordered.findIndex((c) => c.loc === targetLoc);
    if (fromIdx === -1 || toIdx === -1) return;

    const [moved] = ordered.splice(fromIdx, 1);
    const insertIdx = position === 'before' ? (toIdx > fromIdx ? toIdx - 1 : toIdx) : (toIdx >= fromIdx ? toIdx : toIdx + 1);
    ordered.splice(insertIdx, 0, moved);

    // Persist new seq values
    const seqUpdates = ordered.map((c, i) => ({ loc: c.loc, seq: i + 1 }));
    try {
      const fd = new FormData();
      fd.set('updates', JSON.stringify(seqUpdates));
      const res = await fetch('?/reorder', { method: 'POST', body: fd });
      if (!res.ok) throw new Error('Reorder failed');
      invalidateAll();
    } catch (err) {
      childDragError = err instanceof Error ? err.message : 'Reorder failed';
      setTimeout(() => { childDragError = null; }, 3000);
    }
  }

  function resetChildDrag() {
    dragChildLoc = null;
    dropChildTarget = null;
  }

  function childDropClass(loc: string): string {
    if (!dropChildTarget || dropChildTarget.loc !== loc) return '';
    return dropChildTarget.position === 'before' ? 'drop-before' : 'drop-after';
  }
</script>

<svelte:head><title>{node.name || node.title} &middot; Hadron</title></svelte:head>

<div class="max-w-3xl space-y-4">
  <!-- Breadcrumb -->
  <nav class="flex items-center gap-1 text-sm">
    <a href="{basePath}/nodes" class="text-indigo-500 hover:underline dark:text-indigo-400">Nodes</a>
    {#each data.breadcrumb as segment, i}
      <span class="text-zinc-400">/</span>
      {#if i < data.breadcrumb.length - 1}
        <a href="{basePath}/nodes/{encodeURIComponent(segment.path)}" class="text-indigo-500 hover:underline dark:text-indigo-400">{segment.label}</a>
      {:else}
        <span class="text-zinc-700 dark:text-zinc-300">{segment.label}</span>
      {/if}
    {/each}
  </nav>

  <!-- Header -->
  <div class="flex items-center gap-3">
    <h1 class="text-xl font-bold text-zinc-900 dark:text-white">{node.name || node.title}</h1>
    {#if node.isRunnable}
      <span class="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900 dark:text-green-300">runnable</span>
    {/if}
    <a href="{basePath}/browse?focus={encodeURIComponent(node.loc)}" class="ml-auto rounded-md border border-zinc-300 px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800">Graph</a>
    <a href="{basePath}/nodes/{encodeURIComponent(node.loc)}/edit" class="rounded-md border border-zinc-300 px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800">Edit</a>
    {#if !confirmDelete}
      <button class="rounded-md border border-red-300 px-3 py-1 text-xs text-red-500 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950" onclick={() => confirmDelete = true}>Delete</button>
    {:else}
      <form method="POST" action="?/delete" use:enhance class="flex items-center gap-2">
        <span class="text-xs text-red-500">Delete?</span>
        <button type="submit" class="rounded-md bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-500">Yes</button>
        <button type="button" class="text-xs text-zinc-500" onclick={() => confirmDelete = false}>No</button>
      </form>
    {/if}
  </div>

  {#if form?.error}
    <div class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{form.error}</div>
  {/if}

  <!-- Loc -->
  <div class="flex items-center gap-2">
    <code class="font-mono text-sm text-zinc-500">{node.loc}</code>
    <button onclick={copyLoc} class="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300" title="Copy loc">
      {#if locCopied}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
      {:else}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
      {/if}
    </button>
  </div>

  {#if node.description}
    <p class="text-sm text-zinc-700 dark:text-zinc-300">{node.description}</p>
  {/if}

  {#if node.alias}
    <div class="text-sm"><span class="text-zinc-500">Alias:</span> <code class="text-zinc-700 dark:text-zinc-300">{node.alias}</code></div>
  {/if}

  {#if node.tags.length > 0}
    <div class="flex flex-wrap gap-1">
      {#each node.tags as tag}
        <span class="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">{tag}</span>
      {/each}
    </div>
  {/if}

  <!-- Children / References tabs -->
  {#if showTabs}
    <div class="border-t border-zinc-200 pt-4 dark:border-zinc-800">
      <div class="mb-3 flex gap-0 border-b border-zinc-200 dark:border-zinc-800">
        {#if hasChildren}
          <button
            class="border-b-2 px-3 py-1.5 text-sm font-medium {activeTab === 'children' ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-zinc-500'}"
            onclick={() => activeTab = 'children'}
          >Children <span class="ml-1 rounded-full bg-zinc-200 px-1.5 text-xs dark:bg-zinc-800">{children.length}</span></button>
        {/if}
        {#if hasReferences}
          <button
            class="border-b-2 px-3 py-1.5 text-sm font-medium {activeTab === 'references' ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-zinc-500'}"
            onclick={() => activeTab = 'references'}
          >References <span class="ml-1 rounded-full bg-zinc-200 px-1.5 text-xs dark:bg-zinc-800">{node.outgoingEdges.length + node.incomingEdges.length}</span></button>
        {/if}
      </div>

      {#if activeTab === 'children' && hasChildren}
        {#if childrenReorderable && childDragError}
          <div class="mb-2 rounded-lg border border-red-800 bg-red-950 px-3 py-2 text-xs text-red-300">{childDragError}</div>
        {/if}
        <div class="space-y-1">
          {#each children as child}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="rounded-lg border border-zinc-200 dark:border-zinc-800 {childrenReorderable ? childDropClass(child.loc) : ''} {childrenReorderable ? 'cursor-grab' : ''}"
              class:opacity-40={childrenReorderable && dragChildLoc === child.loc}
              draggable={childrenReorderable ? 'true' : undefined}
              ondragstart={(e) => childrenReorderable && handleChildDragStart(e, child.loc)}
              ondragover={(e) => childrenReorderable && handleChildDragOver(e, child.loc)}
              ondragleave={(e) => childrenReorderable && handleChildDragLeave(e)}
              ondrop={(e) => childrenReorderable && handleChildDrop(e)}
              ondragend={() => childrenReorderable && resetChildDrag()}
            >
              <a
                href="{basePath}/nodes/{encodeURIComponent(child.loc)}"
                class="flex items-center gap-3 bg-white px-3 py-2 text-sm hover:bg-zinc-50 dark:bg-zinc-900 dark:hover:bg-zinc-800 rounded-lg"
              >
                <span class="inline-block h-2 w-2 {child.seq !== null ? 'rounded-sm' : 'rounded-full'} {child.isRunnable ? 'bg-green-500' : 'bg-indigo-400'}"></span>
                {#if child.seq !== null}<span class="text-xs tabular-nums text-zinc-500">{child.seq}.</span>{/if}
                <span class="font-medium text-zinc-900 dark:text-white">{child.name || child.title}</span>
                <span class="font-mono text-xs text-zinc-500">{child.loc}</span>
              </a>
            </div>
          {/each}
        </div>
      {/if}

      {#if activeTab === 'references' && hasReferences}
        {#if node.outgoingEdges.length > 0}
          <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Outgoing</h3>
          <div class="mb-4 space-y-1">
            {#each node.outgoingEdges as edge}
              <div class="flex items-center gap-3 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900">
                <a href="{basePath}/nodes/{encodeURIComponent(edge.target.loc)}" class="font-mono text-indigo-500 hover:underline dark:text-indigo-400">{edge.target.name || edge.target.loc}</a>
                {#if edge.label}<span class="text-zinc-500">{edge.label}</span>{/if}
              </div>
            {/each}
          </div>
        {/if}
        {#if node.incomingEdges.length > 0}
          <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Incoming</h3>
          <div class="space-y-1">
            {#each node.incomingEdges as edge}
              <div class="flex items-center gap-3 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900">
                <a href="{basePath}/nodes/{encodeURIComponent(edge.source.loc)}" class="font-mono text-indigo-500 hover:underline dark:text-indigo-400">{edge.source.name || edge.source.loc}</a>
                {#if edge.label}<span class="text-zinc-500">{edge.label}</span>{/if}
              </div>
            {/each}
          </div>
        {/if}
      {/if}
    </div>
  {/if}

  <!-- Content -->
  {#if node.content}
    <div class="border-t border-zinc-200 pt-4 dark:border-zinc-800">
      <div class="flex items-center justify-between">
        <h2 class="text-sm font-semibold uppercase tracking-wide text-zinc-700 dark:text-zinc-300">Content</h2>
        <div class="flex items-center gap-2">
          <div class="flex overflow-hidden rounded-md border border-zinc-300 dark:border-zinc-700">
            <button
              class="px-2 py-1 text-xs {!showSource ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-white' : 'text-zinc-500'}"
              onclick={() => showSource = false}
            >Rendered</button>
            <button
              class="px-2 py-1 text-xs {showSource ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-white' : 'text-zinc-500'}"
              onclick={() => showSource = true}
            >Source</button>
          </div>
          <button onclick={copyContent} class="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300" title="Copy content">
            {#if copied}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
            {:else}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            {/if}
          </button>
        </div>
      </div>
      {#if showSource}
        <pre class="mt-3 overflow-x-auto rounded-lg border border-zinc-200 bg-zinc-50 p-4 font-mono text-sm text-zinc-800 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">{node.content}</pre>
      {:else}
        <div class="prose prose-sm prose-zinc mt-3 max-w-none dark:prose-invert">{@html renderedHtml}</div>
      {/if}
    </div>
  {/if}
</div>

<style>
  :global(.drop-before) {
    border-top: 2px solid #6366f1 !important;
  }
  :global(.drop-after) {
    border-bottom: 2px solid #6366f1 !important;
  }
  :global(.cursor-grab) {
    cursor: grab;
  }
  :global(.cursor-grab:active) {
    cursor: grabbing;
  }
</style>
