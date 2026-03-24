<script lang="ts">
  import { enhance } from '$app/forms';
  import type { PageData, ActionData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  const node = $derived(data.node);
  const basePath = $derived(`/app/orgs/${data.org.id}/memories/${data.graph.id}`);

  let name = $state(node.name);
  let title = $state(node.title);
  let description = $state(node.description ?? '');
  let alias = $state(node.alias ?? '');
  let tagsStr = $state(node.tags.join(', '));
  let content = $state(node.content ?? '');

  // Edge management
  let edges: Array<{ targetId: string; label: string }> = $state(
    node.outgoingEdges.map((e) => ({ targetId: e.target.id, label: e.label }))
  );
  let newTargetLoc = $state('');
  let newLabel = $state('');

  function addEdge() {
    if (newTargetLoc.trim()) {
      // We use targetId here; for loc-based we'd need to resolve, but the API takes targetId
      edges = [...edges, { targetId: newTargetLoc.trim(), label: newLabel.trim() }];
      newTargetLoc = '';
      newLabel = '';
    }
  }

  function removeEdge(index: number) {
    edges = edges.filter((_, i) => i !== index);
  }
</script>

<svelte:head><title>Edit &middot; {node.loc} &middot; Hadron</title></svelte:head>

<div class="max-w-3xl space-y-6">
  <div class="flex items-center gap-3">
    <a href="{basePath}/nodes/{encodeURIComponent(node.loc)}" class="text-sm text-indigo-500 hover:underline dark:text-indigo-400">&larr; Back to node</a>
    <h1 class="font-mono text-lg font-bold text-zinc-900 dark:text-white">{node.loc}</h1>
  </div>

  {#if form?.error}
    <div class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{form.error}</div>
  {/if}

  <form method="POST" use:enhance class="space-y-6">
    <!-- Metadata -->
    <section class="space-y-4">
      <h2 class="border-b border-zinc-200 pb-2 text-sm font-semibold uppercase tracking-wide text-zinc-700 dark:border-zinc-800 dark:text-zinc-300">Metadata</h2>

      <div>
        <label for="name" class="mb-1 block text-sm text-zinc-600 dark:text-zinc-400">Name</label>
        <input id="name" name="name" type="text" bind:value={name}
          class="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none" />
      </div>

      <div>
        <label for="title" class="mb-1 block text-sm text-zinc-600 dark:text-zinc-400">Title</label>
        <input id="title" name="title" type="text" bind:value={title}
          class="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none" />
      </div>

      <div>
        <label for="description" class="mb-1 block text-sm text-zinc-600 dark:text-zinc-400">Description</label>
        <textarea id="description" name="description" rows="3" bind:value={description}
          class="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"></textarea>
      </div>

      <div>
        <label for="alias" class="mb-1 block text-sm text-zinc-600 dark:text-zinc-400">Alias</label>
        <input id="alias" name="alias" type="text" bind:value={alias} placeholder="Optional"
          class="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none" />
      </div>

      <div>
        <label for="tags" class="mb-1 block text-sm text-zinc-600 dark:text-zinc-400">Tags <span class="text-zinc-500">(comma-separated)</span></label>
        <input id="tags" name="tags" type="text" bind:value={tagsStr}
          class="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none" />
      </div>
    </section>

    <!-- References -->
    <section class="space-y-3">
      <h2 class="border-b border-zinc-200 pb-2 text-sm font-semibold uppercase tracking-wide text-zinc-700 dark:border-zinc-800 dark:text-zinc-300">References</h2>
      <input type="hidden" name="edges" value={JSON.stringify(edges)} />
      {#if edges.length > 0}
        <div class="space-y-1">
          {#each edges as edge, i}
            <div class="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm">
              <span class="font-mono text-indigo-400">{edge.targetId}</span>
              <span class="text-zinc-500">{edge.label}</span>
              <button type="button" class="ml-auto text-red-400 hover:text-red-300" onclick={() => removeEdge(i)}>&times;</button>
            </div>
          {/each}
        </div>
      {/if}
      <div class="flex gap-2">
        <input type="text" placeholder="target ID" bind:value={newTargetLoc}
          class="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none" />
        <input type="text" placeholder="label" bind:value={newLabel}
          class="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none" />
        <button type="button" onclick={addEdge}
          class="rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-700">Add</button>
      </div>
    </section>

    <!-- Content -->
    <section class="space-y-3">
      <h2 class="border-b border-zinc-200 pb-2 text-sm font-semibold uppercase tracking-wide text-zinc-700 dark:border-zinc-800 dark:text-zinc-300">Content</h2>
      <textarea name="content" bind:value={content}
        class="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm text-white focus:border-indigo-500 focus:outline-none"
        style="min-height: 400px; resize: vertical;"></textarea>
    </section>

    <!-- Actions -->
    <div class="flex items-center gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
      <button type="submit" class="rounded-lg bg-indigo-600 px-6 py-2 text-sm font-medium text-white hover:bg-indigo-500">Save</button>
      <a href="{basePath}/nodes/{encodeURIComponent(node.loc)}" class="text-sm text-zinc-500 hover:text-zinc-300">Cancel</a>
    </div>
  </form>
</div>
