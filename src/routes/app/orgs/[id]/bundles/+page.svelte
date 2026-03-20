<script lang="ts">
  import { enhance } from '$app/forms';
  import type { PageData, ActionData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const org = $derived(data.org);

  let editingId = $state<string | null>(null);
  let expandedId = $state<string | null>(null);
  let showCreate = $state(false);
</script>

<svelte:head><title>Agents · {org.name} · Hadron</title></svelte:head>

<div class="space-y-6">
  <div class="flex items-start justify-between">
    <div>
      <a href="/app/orgs/{org.id}" class="text-sm text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white">&larr; {org.name}</a>
      <h1 class="mt-1 text-2xl font-bold text-zinc-900 dark:text-white">Agents</h1>
      <p class="text-sm text-zinc-500">Group memories into agents for client subscriptions.</p>
    </div>
    <button
      onclick={() => { showCreate = !showCreate; }}
      class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
    >New Agent</button>
  </div>

  {#if form?.error}
    <div class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{form.error}</div>
  {/if}

  <!-- Create form -->
  {#if showCreate}
    <form method="POST" action="?/create" use:enhance={() => { return async ({ update }) => { showCreate = false; await update(); }; }} class="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <h3 class="mb-3 font-semibold text-zinc-900 dark:text-white">Create Agent</h3>
      <div class="mb-3">
        <label for="name" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">Name</label>
        <input id="name" name="name" type="text" required placeholder="e.g. production"
          class="w-full max-w-md rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none" />
      </div>
      <div class="mb-4">
        <label for="description" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">Description (optional)</label>
        <input id="description" name="description" type="text" placeholder="What this agent is for"
          class="w-full max-w-md rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none" />
      </div>
      <div class="flex gap-3">
        <button type="submit" class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">Create</button>
        <button type="button" onclick={() => { showCreate = false; }} class="px-3 py-2 text-sm text-zinc-500 hover:text-zinc-300">Cancel</button>
      </div>
    </form>
  {/if}

  <!-- Agent list -->
  {#if !org.agents?.length && !showCreate}
    <p class="text-sm text-zinc-500">No agents yet. Create one to group memories for client subscriptions.</p>
  {/if}

  {#each org.agents ?? [] as agent (agent.id)}
    {@const isExpanded = expandedId === agent.id}
    {@const isEditing = editingId === agent.id}
    {@const memoryIdsInAgent = new Set(agent.memoryItems.map((item) => item.memory.id))}
    {@const availableMemories = (org.memories ?? []).filter((m) => !memoryIdsInAgent.has(m.id))}

    <div class="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <!-- Header -->
      <button
        type="button"
        onclick={() => { expandedId = isExpanded ? null : agent.id; editingId = null; }}
        class="flex w-full items-center gap-4 px-5 py-4 text-left transition hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
          class="shrink-0 transition-transform {isExpanded ? 'rotate-90' : ''}"
        ><polyline points="9 18 15 12 9 6"></polyline></svg>
        <div class="flex-1 min-w-0">
          <p class="font-mono text-sm font-medium text-indigo-600 dark:text-indigo-300">{agent.name}</p>
          {#if agent.description}
            <p class="text-xs text-zinc-500">{agent.description}</p>
          {/if}
        </div>
        <span class="text-xs text-zinc-400">{agent.memoryItems.length} memor{agent.memoryItems.length !== 1 ? 'ies' : 'y'}</span>
      </button>

      <!-- Expanded content -->
      {#if isExpanded}
        <div class="border-t border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <!-- Edit / Delete actions -->
          {#if isEditing}
            <form method="POST" action="?/update" use:enhance={() => { return async ({ update }) => { editingId = null; await update(); }; }} class="mb-4">
              <input type="hidden" name="id" value={agent.id} />
              <div class="mb-3">
                <label class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">Name</label>
                <input name="name" type="text" required value={agent.name}
                  class="w-full max-w-md rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none" />
              </div>
              <div class="mb-3">
                <label class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">Description</label>
                <input name="description" type="text" value={agent.description ?? ''}
                  class="w-full max-w-md rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none" />
              </div>
              <div class="flex gap-3">
                <button type="submit" class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">Save</button>
                <button type="button" onclick={() => { editingId = null; }} class="px-3 py-2 text-sm text-zinc-500 hover:text-zinc-300">Cancel</button>
              </div>
            </form>
          {:else}
            <div class="mb-4 flex items-center gap-3">
              <button type="button" onclick={() => { editingId = agent.id; }}
                class="text-xs leading-tight text-indigo-500 hover:text-indigo-400">Edit</button>
              <form method="POST" action="?/delete" use:enhance class="flex"
                onsubmit={(e) => { if (!confirm(`Delete agent "${agent.name}"?`)) e.preventDefault(); else expandedId = null; }}
              >
                <input type="hidden" name="id" value={agent.id} />
                <button type="submit" class="text-xs leading-tight text-red-400 hover:text-red-300">Delete</button>
              </form>
            </div>
          {/if}

          <!-- Memories in this agent -->
          <h4 class="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">Memories in this agent</h4>
          {#if agent.memoryItems.length}
            <div class="mb-3 divide-y divide-zinc-200 rounded-lg border border-zinc-200 overflow-hidden dark:divide-zinc-800 dark:border-zinc-800">
              {#each agent.memoryItems as item (item.id)}
                <div class="flex items-center justify-between bg-zinc-50 px-4 py-3 dark:bg-zinc-900">
                  <p class="font-mono text-sm text-zinc-900 dark:text-zinc-200">{item.memory.name}</p>
                  <form method="POST" action="?/removeMemory" use:enhance>
                    <input type="hidden" name="agentId" value={agent.id} />
                    <input type="hidden" name="memoryId" value={item.memory.id} />
                    <button type="submit" class="text-xs text-red-400 hover:text-red-300">Remove</button>
                  </form>
                </div>
              {/each}
            </div>
          {:else}
            <p class="mb-3 text-sm text-zinc-500">No memories added yet.</p>
          {/if}

          <!-- Add memory -->
          {#if availableMemories.length > 0}
            <form method="POST" action="?/addMemory" use:enhance class="flex items-end gap-3">
              <input type="hidden" name="agentId" value={agent.id} />
              <div>
                <label class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">Add memory</label>
                <select name="memoryId" class="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm text-white">
                  {#each availableMemories as m (m.id)}
                    <option value={m.id}>{m.name}</option>
                  {/each}
                </select>
              </div>
              <button type="submit" class="rounded-lg bg-zinc-200 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-300 dark:bg-zinc-700 dark:text-white dark:hover:bg-zinc-600">Add</button>
            </form>
          {:else if (org.memories ?? []).length === 0}
            <p class="text-xs text-zinc-500">No memories in this organization yet.</p>
          {:else}
            <p class="text-xs text-zinc-500">All memories are already in this agent.</p>
          {/if}
        </div>
      {/if}
    </div>
  {/each}
</div>
