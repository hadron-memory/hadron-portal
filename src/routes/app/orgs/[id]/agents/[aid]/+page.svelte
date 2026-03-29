<script lang="ts">
  import { enhance } from '$app/forms';
  import type { PageData, ActionData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const agent = $derived(data.agent);
  const org = $derived(data.org);

  let isEditing = $state(false);
  let confirmDelete = $state(false);
  let urnCopied = $state(false);

  const inputClass = "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500";

  function urnSlug(urn: string): string {
    return urn.includes(':') ? urn.split(':').slice(1).join(':') : urn;
  }

  async function copyUrn() {
    try {
      await navigator.clipboard.writeText(agent.urn);
      urnCopied = true;
      setTimeout(() => (urnCopied = false), 2000);
    } catch {}
  }

  const memoryIdsInAgent = $derived(new Set(agent.memoryItems.map((item) => item.memory.id)));
  const subscribedMemories = $derived((org.subscriptions ?? []).map((s) => s.memory));
  const allMemories = $derived([...(org.memories ?? []), ...subscribedMemories]);
  const availableMemories = $derived(allMemories.filter((m) => !memoryIdsInAgent.has(m.id)));
</script>

<svelte:head><title>{agent.name} · Agents · Hadron</title></svelte:head>

<div class="max-w-2xl space-y-6">
  <!-- Breadcrumb -->
  <nav class="flex items-center gap-1 text-sm flex-wrap">
    <a href="/app/orgs" class="text-indigo-500 hover:underline dark:text-indigo-400">Organizations</a>
    <span class="text-zinc-400">/</span>
    <a href="/app/orgs/{org.id}" class="text-indigo-500 hover:underline dark:text-indigo-400">{org.name}</a>
    <span class="text-zinc-400">/</span>
    <a href="/app/orgs/{org.id}/agents" class="text-indigo-500 hover:underline dark:text-indigo-400">Agents</a>
    <span class="text-zinc-400">/</span>
    <span class="text-zinc-700 dark:text-zinc-300">{agent.name}</span>
  </nav>

  <!-- Header -->
  <div class="flex items-start justify-between">
    <div>
      <h1 class="text-2xl font-bold text-zinc-900 dark:text-white">{agent.name}</h1>
      <div class="flex items-center gap-2 mt-1">
        <code class="font-mono text-sm text-zinc-500">{agent.urn}</code>
        <button onclick={copyUrn} class="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300" title="Copy URN">
          {#if urnCopied}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
          {:else}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
          {/if}
        </button>
      </div>
      {#if agent.description && !isEditing}
        <p class="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{agent.description}</p>
      {/if}
    </div>
    <div class="flex items-center gap-2">
      {#if !isEditing}
        <button onclick={() => isEditing = true} class="rounded-md border border-zinc-300 px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800">Edit</button>
      {/if}
      {#if !confirmDelete}
        <button onclick={() => confirmDelete = true} class="rounded-md border border-red-300 px-3 py-1 text-xs text-red-500 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950">Delete</button>
      {:else}
        <form method="POST" action="?/delete" use:enhance class="flex items-center gap-2">
          <span class="text-xs text-red-500">Delete?</span>
          <button type="submit" class="rounded-md bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-500">Yes</button>
          <button type="button" class="text-xs text-zinc-500" onclick={() => confirmDelete = false}>No</button>
        </form>
      {/if}
    </div>
  </div>

  {#if form?.error}
    <div class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{form.error}</div>
  {/if}
  {#if form?.success}
    <div class="rounded-lg border border-green-800 bg-green-950 px-4 py-3 text-sm text-green-300">Changes saved.</div>
  {/if}

  <!-- Edit form -->
  {#if isEditing}
    <form method="POST" action="?/update" use:enhance={() => { return async ({ update }) => { isEditing = false; await update(); }; }} class="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900 space-y-4">
      <div>
        <label for="editName" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Name</label>
        <input id="editName" name="name" type="text" required value={agent.name} class={inputClass} />
      </div>
      <div>
        <label for="editUrn" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">URN</label>
        <div class="flex items-stretch">
          <span class="inline-flex items-center rounded-l-lg border border-r-0 border-zinc-300 bg-zinc-100 px-3 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">{org.urn}:</span>
          <input id="editUrn" name="urnSlug" type="text" required value={urnSlug(agent.urn)}
            class="w-full rounded-r-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500" />
        </div>
      </div>
      <div>
        <label for="editDescription" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Description</label>
        <input id="editDescription" name="description" type="text" value={agent.description ?? ''} placeholder="What this agent is for" class={inputClass} />
      </div>
      <div class="flex gap-3">
        <button type="submit" class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">Save</button>
        <button type="button" onclick={() => isEditing = false} class="px-3 py-2 text-sm text-zinc-500 hover:text-zinc-300">Cancel</button>
      </div>
    </form>
  {/if}

  <!-- Memories -->
  <section>
    <h2 class="mb-3 font-semibold text-zinc-900 dark:text-white">Memories <span class="ml-1 text-sm font-normal text-zinc-500">({agent.memoryItems.length})</span></h2>

    {#if agent.memoryItems.length}
      <div class="mb-4 divide-y divide-zinc-200 rounded-xl border border-zinc-200 overflow-hidden dark:divide-zinc-800 dark:border-zinc-800">
        {#each agent.memoryItems as item (item.id)}
          <div class="flex items-center gap-4 bg-white px-5 py-4 dark:bg-zinc-900">
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-zinc-900 dark:text-zinc-200">{item.memory.name}</p>
              <p class="font-mono text-xs text-zinc-400">{item.memory.urn}</p>
            </div>
            <span class="rounded px-2 py-0.5 text-xs {item.role === 'read-write' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300' : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'}">{item.role}</span>
            <form method="POST" action="?/removeMemory" use:enhance>
              <input type="hidden" name="memoryId" value={item.memory.id} />
              <button type="submit" class="text-xs text-red-400 hover:text-red-300">Remove</button>
            </form>
          </div>
        {/each}
      </div>
    {:else}
      <p class="mb-4 text-sm text-zinc-500">No memories added yet.</p>
    {/if}

    {#if availableMemories.length > 0}
      <form method="POST" action="?/addMemory" use:enhance class="flex items-end gap-3">
        <div class="flex-1 max-w-md">
          <label for="addMemory" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">Add memory</label>
          <select id="addMemory" name="memoryId" class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white">
            {#each availableMemories as m (m.id)}
              <option value={m.id}>{m.name} ({m.urn})</option>
            {/each}
          </select>
        </div>
        <div>
          <label for="memRole" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">Access</label>
          <select id="memRole" name="role" class="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white">
            <option value="read">Read</option>
            <option value="read-write">Read/Write</option>
          </select>
        </div>
        <button type="submit" class="rounded-lg bg-zinc-200 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-300 dark:bg-zinc-700 dark:text-white dark:hover:bg-zinc-600">Add</button>
      </form>
    {:else if allMemories.length === 0}
      <p class="text-xs text-zinc-500">No memories available. Create a memory first.</p>
    {:else}
      <p class="text-xs text-zinc-500">All available memories are already in this agent.</p>
    {/if}
  </section>

  <!-- Placeholder for future features -->
  <section>
    <h2 class="mb-3 font-semibold text-zinc-900 dark:text-white">Tools</h2>
    <p class="text-sm text-zinc-500">Tool calling configuration will be available here in a future update.</p>
  </section>
</div>
