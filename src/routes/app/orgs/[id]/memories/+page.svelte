<script lang="ts">
  import { enhance } from '$app/forms';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import CopyUrn from '$lib/components/CopyUrn.svelte';
  import type { PageData, ActionData } from './$types';
  let { data, form }: { data: PageData; form: ActionData } = $props();
  const org = $derived(data.org);
</script>

<svelte:head><title>Memories · {org.name} · Hadron</title></svelte:head>

<div class="space-y-6">
  <!-- Breadcrumb + header -->
  <div class="flex items-center justify-between">
    <div>
      <Breadcrumb items={[
        { label: 'Organizations', href: '/app/orgs' },
        { label: org.name, href: `/app/orgs/${org.id}` },
        { label: 'Memories' },
      ]} />
      <h1 class="mt-1 text-2xl font-bold text-zinc-900 dark:text-white">Memories</h1>
    </div>
    <div class="flex items-center gap-3">
      <form method="POST" action="?/syncAll" use:enhance>
        <button type="submit" class="cursor-pointer rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-600 hover:border-zinc-400 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-500 dark:hover:text-white">
          Sync all
        </button>
      </form>
      <a href="/app/orgs/{org.id}/memories/new" class="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">
        + Add memory
      </a>
    </div>
  </div>

  {#if form?.error}
    <div class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{form.error}</div>
  {/if}
  {#if form?.synced}
    <div class="rounded-lg border border-green-800 bg-green-950 px-4 py-3 text-sm text-green-300">All memories synced.</div>
  {/if}
  {#if form?.subscribed}
    <div class="rounded-lg border border-green-800 bg-green-950 px-4 py-3 text-sm text-green-300">Subscribed to memory.</div>
  {/if}

  {#if !org.memories?.length}
    <div class="rounded-xl border border-zinc-200 bg-white p-12 text-center text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
      No memories yet. <a href="/app/orgs/{org.id}/memories/new" class="text-indigo-600 hover:underline dark:text-indigo-400">Add one →</a>
    </div>
  {:else}
    <div class="space-y-3">
      {#each org.memories as g (g.id)}
        <div class="flex items-center gap-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <div class="flex-1 min-w-0">
            <a href="/app/orgs/{org.id}/memories/{g.id}/browse" class="text-sm font-semibold text-indigo-600 hover:underline dark:text-indigo-300">{g.name}</a>
            <span class="ml-2 rounded px-1.5 py-0.5 text-xs {g.visibility === 'PUBLIC' ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'}">{g.visibility}</span>
            <CopyUrn value={g.urn} size={10} />
            <div class="mt-1 flex flex-wrap gap-3 text-xs text-zinc-500">
              {#if g.source}<span>git-backed</span>{:else}<span>DB-only</span>{/if}
              {#if g.readBranch}<span>branch: {g.readBranch}</span>{/if}
              {#if g.lastSyncedAt}<span>synced {new Date(g.lastSyncedAt).toLocaleDateString()}</span>{/if}
            </div>
          </div>
          <div class="flex items-center gap-3">
            <a href="/app/orgs/{org.id}/memories/{g.id}" class="text-sm text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white">Edit</a>
            <form method="POST" action="?/delete" use:enhance onsubmit={(e) => { if (!confirm(`Delete "${g.name}"?`)) e.preventDefault(); }}>
              <input type="hidden" name="id" value={g.id} />
              <button type="submit" class="text-sm text-red-400 hover:text-red-300">Delete</button>
            </form>
          </div>
        </div>
      {/each}
    </div>
  {/if}

  <!-- Subscribed memories from other orgs -->
  {#if org.subscriptions?.length}
    <div>
      <h2 class="mb-3 text-lg font-semibold text-zinc-900 dark:text-white">Subscribed memories <span class="ml-1 text-sm font-normal text-zinc-500">({org.subscriptions.length})</span></h2>
      <div class="space-y-3">
        {#each org.subscriptions as s (s.id)}
          <div class="flex items-center gap-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
            <div class="flex-1 min-w-0">
              <span class="text-sm font-semibold text-indigo-600 dark:text-indigo-300">{s.memory.name}</span>
              <span class="ml-2 rounded px-1.5 py-0.5 text-xs bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300">{s.role}</span>
              <CopyUrn value={s.memory.urn} size={10} />
              <p class="mt-1 text-xs text-zinc-500">from {s.memory.organization?.name ?? 'unknown'} ({s.memory.organization?.urn ?? ''})</p>
            </div>
            <form method="POST" action="?/unsubscribe" use:enhance onsubmit={(e) => { if (!confirm(`Unsubscribe from "${s.memory.name}"?`)) e.preventDefault(); }}>
              <input type="hidden" name="memoryId" value={s.memory.id} />
              <button type="submit" class="text-sm text-red-400 hover:text-red-300">Unsubscribe</button>
            </form>
          </div>
        {/each}
      </div>
    </div>
  {/if}

  <!-- Subscribe to external memories -->
  <div>
    <h2 class="mb-3 text-lg font-semibold text-zinc-900 dark:text-white">Subscribe to a memory</h2>
    {#if data.availableMemories.length === 0}
      <p class="text-sm text-zinc-500">No public memories available to subscribe to.</p>
    {:else}
      <form method="POST" action="?/subscribe" use:enhance class="flex items-end gap-3 max-w-lg">
        <div class="flex-1">
          <label for="memoryId" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">Public memory</label>
          <select id="memoryId" name="memoryId" required class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white">
            <option value="">Select a memory...</option>
            {#each data.availableMemories as m (m.id)}
              <option value={m.id}>{m.name} ({m.urn})</option>
            {/each}
          </select>
        </div>
        <div>
          <label for="subRole" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">Role</label>
          <select id="subRole" name="role" class="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white">
            <option value="READER">Reader</option>
            <option value="CONTRIBUTOR">Contributor</option>
          </select>
        </div>
        <button type="submit" class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">Subscribe</button>
      </form>
    {/if}
  </div>
</div>
