<script lang="ts">
  import { enhance } from '$app/forms';
  import type { PageData, ActionData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const g = $derived(data.graph);
</script>

<svelte:head><title>{g.name} &middot; Settings &middot; Hadron</title></svelte:head>

<div class="space-y-8">
  <div>
    <div class="mt-1 flex flex-wrap gap-3 text-sm text-zinc-500">
      {#if g.syncStatus}
        <span>Sync: {g.syncStatus}</span>
      {/if}
      {#if g.lastSyncedAt}
        <span>Last synced {new Date(g.lastSyncedAt).toLocaleString()}</span>
      {/if}
    </div>
    {#if g.syncError}
      <p class="mt-1 text-sm text-red-400">Sync error: {g.syncError}</p>
    {/if}
  </div>

  {#if form?.error}
    <div class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{form.error}</div>
  {/if}
  {#if form?.success || form?.synced}
    <div class="rounded-lg border border-green-800 bg-green-950 px-4 py-3 text-sm text-green-300">
      {form.synced ? 'Memory synced.' : 'Changes saved.'}
    </div>
  {/if}

  <!-- Edit form -->
  <section>
    <h2 class="mb-4 font-semibold text-zinc-900 dark:text-white">Settings</h2>
    <form id="graph-settings" method="POST" action="?/update" use:enhance class="max-w-lg space-y-4">
      <div>
        <label for="source" class="mb-1 block text-sm text-zinc-700 dark:text-zinc-300">Git source URL</label>
        <input id="source" name="source" type="text" value={g.source ?? ''}
          class="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none" />
      </div>
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label for="readBranch" class="mb-1 block text-sm text-zinc-700 dark:text-zinc-300">Read branch</label>
          <input id="readBranch" name="readBranch" type="text" value={g.readBranch ?? ''}
            class="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none" />
        </div>
        <div>
          <label for="writeBranch" class="mb-1 block text-sm text-zinc-700 dark:text-zinc-300">Write branch</label>
          <input id="writeBranch" name="writeBranch" type="text" value={g.writeBranch ?? ''}
            class="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none" />
        </div>
      </div>
      <div>
        <label for="visibility" class="mb-1 block text-sm text-zinc-700 dark:text-zinc-300">Visibility</label>
        <select id="visibility" name="visibility" class="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white">
          <option value="PRIVATE" selected={g.visibility === 'PRIVATE'}>Private</option>
          <option value="ORGANIZATION" selected={g.visibility === 'ORGANIZATION'}>Organization</option>
          <option value="PUBLIC" selected={g.visibility === 'PUBLIC'}>Public</option>
        </select>
      </div>
    </form>
    <div class="mt-4 flex gap-3">
      <button type="submit" form="graph-settings" class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">Save</button>
      <form method="POST" action="?/sync" use:enhance>
        <button type="submit" class="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-600 hover:border-zinc-400 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-500 dark:hover:text-white">
          ↻ Sync now
        </button>
      </form>
    </div>
  </section>

  <!-- Subscriptions -->
  <section>
    <h2 class="mb-4 font-semibold text-zinc-900 dark:text-white">Org subscriptions
      <span class="ml-1 text-sm font-normal text-zinc-500">({g.subscriptions?.length ?? 0})</span>
    </h2>

    {#if g.subscriptions?.length}
      <div class="mb-4 divide-y divide-zinc-200 rounded-xl border border-zinc-200 overflow-hidden dark:divide-zinc-800 dark:border-zinc-800">
        {#each g.subscriptions as s (s.id)}
          <div class="flex items-center gap-4 bg-white px-5 py-4 dark:bg-zinc-900">
            <div class="flex-1">
              <p class="text-sm text-zinc-900 dark:text-white">{s.organization.name}</p>
              <p class="font-mono text-xs text-zinc-500">{s.organization.domain}</p>
            </div>
            <span class="text-xs text-zinc-500">{s.role}</span>
            <form method="POST" action="?/unsubscribe" use:enhance>
              <input type="hidden" name="orgId" value={s.organization.id} />
              <button type="submit" class="text-xs text-red-400 hover:text-red-300">Remove</button>
            </form>
          </div>
        {/each}
      </div>
    {/if}

    <form method="POST" action="?/subscribe" use:enhance class="flex items-end gap-3 max-w-md">
      <div class="flex-1">
        <label for="subOrgId" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">Organization ID</label>
        <input id="subOrgId" name="orgId" type="text" required placeholder="org-cuid"
          class="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none" />
      </div>
      <div>
        <label for="subRole" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">Role</label>
        <select id="subRole" name="role" class="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white">
          <option value="READER">Reader</option>
          <option value="CONTRIBUTOR">Contributor</option>
        </select>
      </div>
      <button type="submit" class="rounded-lg bg-zinc-200 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-300 dark:bg-zinc-700 dark:text-white dark:hover:bg-zinc-600">Add</button>
    </form>
  </section>
</div>
