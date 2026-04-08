<script lang="ts">
  import { enhance } from '$app/forms';
  import Urn from '$lib/components/Urn.svelte';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import type { PageData, ActionData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const agent = $derived(data.agent);
  const org = $derived(data.org);

  let isEditing = $state(false);
  let confirmDelete = $state(false);

  const inputClass = "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500";

  function urnSlug(urn: string): string {
    return urn.includes(':') ? urn.split(':').slice(1).join(':') : urn;
  }

  const visibilityRank: Record<string, number> = { PRIVATE: 0, ORGANIZATION: 1, PUBLIC: 2 };
  const visibilityLabel: Record<string, string> = { PRIVATE: 'Private', ORGANIZATION: 'Organization', PUBLIC: 'Public' };

  const restrictiveMemories = $derived(
    agent.memoryItems.filter((item) =>
      visibilityRank[item.memory.visibility] < visibilityRank[agent.visibility]
    )
  );

  let selectedAddMemoryId = $state('');
  const selectedAddMemory = $derived(
    allMemories.find((m) => m.id === selectedAddMemoryId)
  );
  const addMemoryWarning = $derived(
    selectedAddMemory && 'visibility' in selectedAddMemory &&
    visibilityRank[(selectedAddMemory as any).visibility] < visibilityRank[agent.visibility]
      ? `This memory is ${visibilityLabel[(selectedAddMemory as any).visibility]} but the agent is ${visibilityLabel[agent.visibility]}. The effective access will be ${visibilityLabel[(selectedAddMemory as any).visibility]}.`
      : ''
  );

  const memoryIdsInAgent = $derived(new Set(agent.memoryItems.map((item) => item.memory.id)));
  // Collect memories from all orgs the user has access to
  const allMemories = $derived.by(() => {
    const seen = new Set<string>();
    const result: Array<{ id: string; urn: string; name: string; visibility?: string; orgName?: string }> = [];
    for (const o of (data as any).allOrgs ?? [org]) {
      for (const m of o.memories ?? []) {
        if (!seen.has(m.id)) {
          seen.add(m.id);
          result.push({ ...m, orgName: o.name });
        }
      }
      for (const s of o.subscriptions ?? []) {
        if (!seen.has(s.memory.id)) {
          seen.add(s.memory.id);
          result.push({ ...s.memory, orgName: s.memory.organization?.name ?? o.name });
        }
      }
    }
    return result;
  });
  const availableMemories = $derived(allMemories.filter((m) => !memoryIdsInAgent.has(m.id)));
</script>

<svelte:head><title>{agent.name} · Agents · Hadron</title></svelte:head>

<div class="max-w-2xl space-y-6">
  <!-- Breadcrumb -->
  <Breadcrumb items={[
    { label: 'Organizations', href: '/app/orgs' },
    { label: org.name, href: `/app/orgs/${org.id}` },
    { label: 'Agents', href: `/app/orgs/${org.id}/agents` },
    { label: agent.name },
  ]} />

  <!-- Header -->
  <div class="flex items-start justify-between">
    <div>
      <h1 class="text-2xl font-bold text-zinc-900 dark:text-white"><span class="text-zinc-400 font-normal">Agent:</span> {agent.name}</h1>
      <Urn value={agent.urn} type="agent" />
      {#if agent.description}
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

  {#if restrictiveMemories.length > 0}
    <div class="rounded-lg border border-amber-700 bg-amber-950 px-4 py-3 text-sm text-amber-300">
      Visibility mismatch: this agent is <strong>{visibilityLabel[agent.visibility]}</strong> but
      {restrictiveMemories.length === 1 ? 'memory' : 'memories'}
      {restrictiveMemories.map((m) => m.memory.name).join(', ')}
      {restrictiveMemories.length === 1 ? 'is' : 'are'} more restrictive.
      Effective access will be limited to the most restrictive level.
    </div>
  {/if}

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
        <textarea id="editDescription" name="description" rows="3" placeholder="What this agent is for" class={inputClass}>{agent.description ?? ''}</textarea>
      </div>
      <div>
        <label for="editSystemPrompt" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">System Prompt</label>
        <textarea id="editSystemPrompt" name="systemPrompt" rows="4" placeholder="Instructions for the LLM when using this agent" class={inputClass}>{agent.systemPrompt ?? ''}</textarea>
        <p class="mt-1 text-xs text-zinc-400">Sent to the LLM at the start of each session.</p>
      </div>
      <div>
        <label for="editVisibility" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Visibility</label>
        <select id="editVisibility" name="visibility" class="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white">
          <option value="PRIVATE" selected={agent.visibility === 'PRIVATE'}>Private</option>
          <option value="ORGANIZATION" selected={agent.visibility === 'ORGANIZATION'}>Organization</option>
          <option value="PUBLIC" selected={agent.visibility === 'PUBLIC'}>Public</option>
        </select>
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
            <span class="w-3.5 shrink-0">
              {#if item.role !== 'read-write'}
                <span title="Read only"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-zinc-400"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg></span>
              {/if}
            </span>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium">
                <a href="/app/orgs/{org.id}/memories/{item.memory.id}/browse" class="text-indigo-600 hover:underline dark:text-indigo-300">{item.memory.name}</a>
                {#if visibilityRank[item.memory.visibility] < visibilityRank[agent.visibility]}
                  <span class="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-900 dark:text-amber-300" title="More restrictive than agent">{visibilityLabel[item.memory.visibility]}</span>
                {/if}
              </p>
              <Urn value={item.memory.urn} type="memory" size={10} />
            </div>
            <form method="POST" action="?/updateMemoryRole" use:enhance class="flex items-center">
              <input type="hidden" name="memoryId" value={item.memory.id} />
              <select name="role" onchange={(e) => (e.target as HTMLSelectElement).form?.requestSubmit()} class="rounded-full border px-2.5 py-0.5 text-xs font-medium {item.role === 'read-write' ? '[border-color:rgb(134,239,172)] [background-color:rgb(240,253,244)] [color:rgb(21,128,61)] dark:[border-color:rgb(22,101,52)] dark:[background-color:rgb(20,83,45)] dark:[color:rgb(134,239,172)]' : '[border-color:rgb(252,211,77)] [background-color:rgb(255,251,235)] [color:rgb(180,83,9)] dark:[border-color:rgb(120,53,15)] dark:[background-color:rgb(69,26,3)] dark:[color:rgb(252,211,77)]'}">
                <option value="read" selected={item.role === 'read'}>read</option>
                <option value="read-write" selected={item.role === 'read-write'}>read-write</option>
              </select>
            </form>
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
      <form method="POST" action="?/addMemory" use:enhance class="space-y-2">
        <div class="flex items-end gap-3">
        <div class="flex-1 max-w-md">
          <label for="addMemory" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">Add memory</label>
          <select id="addMemory" name="memoryId" bind:value={selectedAddMemoryId} class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white">
            {#each availableMemories as m (m.id)}
              <option value={m.id}>{m.name} ({m.urn}){#if m.orgName && m.orgName !== org.name} — {m.orgName}{/if}</option>
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
        </div>
        {#if addMemoryWarning}
          <p class="text-xs text-amber-600 dark:text-amber-400">{addMemoryWarning}</p>
        {/if}
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
