<script lang="ts">
  import { enhance } from '$app/forms';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import type { PageData, ActionData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const g = $derived(data.graph);

  let githubOpen = $state(false);
  let saving = $state(false);
  let syncing = $state(false);
  let pushing = $state(false);

  // Auto-open GitHub section if source is configured
  $effect(() => {
    if (g.source) githubOpen = true;
  });

  // Extract slug from URN (part after org:)
  const urnSlug = $derived(g.urn ? g.urn.split(':').slice(1).join(':') : '');

  const inputClass = "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500";

  function savingEnhance(formEl: HTMLFormElement) {
    return enhance(formEl, () => {
      saving = true;
      return async ({ update }) => { saving = false; await update(); };
    });
  }
  function syncingEnhance(formEl: HTMLFormElement) {
    return enhance(formEl, () => {
      syncing = true;
      return async ({ update }) => { syncing = false; await update(); };
    });
  }
  function pushingEnhance(formEl: HTMLFormElement) {
    return enhance(formEl, () => {
      pushing = true;
      return async ({ update }) => { pushing = false; await update(); };
    });
  }
</script>

<svelte:head><title>{g.name} &middot; Settings &middot; Hadron</title></svelte:head>

<div class="space-y-8">
  <!-- Breadcrumb + sync status -->
  <div>
    <Breadcrumb items={[
      { label: 'Organizations', href: '/app/orgs' },
      { label: data.org.name, href: `/app/orgs/${data.org.id}` },
      { label: 'Memories', href: `/app/orgs/${data.org.id}/memories` },
      { label: g.name, href: `/app/orgs/${data.org.id}/memories/${g.id}/browse` },
      { label: 'Settings' },
    ]} />
    <div class="mt-2 flex flex-wrap gap-3 text-sm text-zinc-500">
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
  {#if form?.success || form?.synced || (form as any)?.pushed}
    <div class="rounded-lg border border-green-800 bg-green-950 px-4 py-3 text-sm text-green-300">
      {form?.synced ? 'Memory synced.' : (form as any)?.pushed ? 'Pushed to Git.' : 'Changes saved.'}
    </div>
  {/if}

  <!-- Edit form -->
  <section>
    <h2 class="mb-4 font-semibold text-zinc-900 dark:text-white">Settings</h2>
    <form id="graph-settings" method="POST" action="?/update" use:savingEnhance class="max-w-lg space-y-4">

      <!-- Name (display name) -->
      <div>
        <label for="displayName" class="mb-1 block text-sm text-zinc-700 dark:text-zinc-300">Name</label>
        <input id="displayName" name="displayName" type="text" value={g.name}
          class={inputClass} />
      </div>

      <!-- Organization -->
      {#if (data as any).allOrgs && (data as any).allOrgs.length > 1}
        <div>
          <label for="organizationId" class="mb-1 block text-sm text-zinc-700 dark:text-zinc-300">Organization</label>
          <select id="organizationId" name="organizationId" class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white">
            {#each (data as any).allOrgs as org (org.id)}
              <option value={org.id} selected={org.id === g.organizationId}>{org.name} ({org.urn})</option>
            {/each}
          </select>
        </div>
      {/if}

      <!-- URN -->
      <div>
        <label for="urnSlugInput" class="mb-1 block text-sm text-zinc-700 dark:text-zinc-300">URN</label>
        <div class="flex items-stretch">
          <span class="inline-flex items-center rounded-l-lg border border-r-0 border-zinc-300 bg-zinc-100 px-3 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">{data.org.urn}:</span>
          <input id="urnSlugInput" name="urnSlug" type="text" value={urnSlug}
            class="w-full rounded-r-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500" />
        </div>
      </div>

      <div>
        <label for="shortDescription" class="mb-1 block text-sm text-zinc-700 dark:text-zinc-300">Short description</label>
        <input id="shortDescription" name="shortDescription" type="text" value={g.shortDescription ?? ''}
          class={inputClass} />
      </div>
      <div>
        <label for="description" class="mb-1 block text-sm text-zinc-700 dark:text-zinc-300">Description</label>
        <textarea id="description" name="description" rows="3"
          class={inputClass}>{g.description ?? ''}</textarea>
      </div>
      <div>
        <label for="tags" class="mb-1 block text-sm text-zinc-700 dark:text-zinc-300">Tags <span class="text-zinc-500">(comma-separated)</span></label>
        <input id="tags" name="tags" type="text" value={(g.tags ?? []).join(', ')}
          class={inputClass} />
      </div>
      <div class="grid grid-cols-3 gap-4">
        <div>
          <label for="category0" class="mb-1 block text-sm text-zinc-700 dark:text-zinc-300">Category</label>
          <input id="category0" name="category0" type="text" value={g.category0 ?? ''}
            class={inputClass} />
        </div>
        <div>
          <label for="category1" class="mb-1 block text-sm text-zinc-700 dark:text-zinc-300">Subcategory</label>
          <input id="category1" name="category1" type="text" value={g.category1 ?? ''}
            class={inputClass} />
        </div>
        <div>
          <label for="category2" class="mb-1 block text-sm text-zinc-700 dark:text-zinc-300">Sub-subcategory</label>
          <input id="category2" name="category2" type="text" value={g.category2 ?? ''}
            class={inputClass} />
        </div>
      </div>
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label for="license" class="mb-1 block text-sm text-zinc-700 dark:text-zinc-300">License</label>
          <input id="license" name="license" type="text" value={g.license ?? ''}
            class={inputClass} />
        </div>
        <div>
          <label for="homeUrl" class="mb-1 block text-sm text-zinc-700 dark:text-zinc-300">Home URL</label>
          <input id="homeUrl" name="homeUrl" type="url" value={g.homeUrl ?? ''}
            class={inputClass} />
        </div>
      </div>
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label for="iconUrl" class="mb-1 block text-sm text-zinc-700 dark:text-zinc-300">Icon URL</label>
          <input id="iconUrl" name="iconUrl" type="url" value={g.iconUrl ?? ''}
            class={inputClass} />
        </div>
        <div>
          <label for="heroUrl" class="mb-1 block text-sm text-zinc-700 dark:text-zinc-300">Hero image URL</label>
          <input id="heroUrl" name="heroUrl" type="url" value={g.heroUrl ?? ''}
            class={inputClass} />
        </div>
      </div>
      <div>
        <label for="visibility" class="mb-1 block text-sm text-zinc-700 dark:text-zinc-300">Visibility</label>
        <select id="visibility" name="visibility" class="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white">
          <option value="PRIVATE" selected={g.visibility === 'PRIVATE'}>Private</option>
          <option value="ORGANIZATION" selected={g.visibility === 'ORGANIZATION'}>Organization</option>
          <option value="PUBLIC" selected={g.visibility === 'PUBLIC'}>Public</option>
        </select>
      </div>

      <!-- GitHub integration (collapsed unless source is set) -->
      <div class="rounded-lg border border-zinc-200 dark:border-zinc-800">
        <button
          type="button"
          onclick={() => githubOpen = !githubOpen}
          class="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800/50 rounded-lg"
        >
          <span>GitHub integration {#if !g.source}<span class="font-normal text-zinc-500">(optional)</span>{/if}</span>
          <svg width="12" height="12" viewBox="0 0 12 12" class="transition-transform {githubOpen ? 'rotate-90' : ''}">
            <path d="M4 2 L8 6 L4 10" stroke="currentColor" fill="none" stroke-width="1.5" />
          </svg>
        </button>

        {#if githubOpen}
          <div class="space-y-4 border-t border-zinc-200 px-4 py-4 dark:border-zinc-800">
            <div>
              <label for="source" class="mb-1 block text-sm text-zinc-700 dark:text-zinc-300">Git source URL</label>
              <input id="source" name="source" type="text" value={g.source ?? ''} placeholder="https://github.com/owner/repo.git"
                class={inputClass} />
            </div>
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label for="readBranch" class="mb-1 block text-sm text-zinc-700 dark:text-zinc-300">Read branch</label>
                <input id="readBranch" name="readBranch" type="text" value={g.readBranch ?? ''} placeholder="main"
                  class={inputClass} />
              </div>
              <div>
                <label for="writeBranch" class="mb-1 block text-sm text-zinc-700 dark:text-zinc-300">Write branch</label>
                <input id="writeBranch" name="writeBranch" type="text" value={g.writeBranch ?? ''} placeholder="hadron-updates"
                  class={inputClass} />
              </div>
            </div>
          </div>
        {/if}
      </div>
    </form>
    <div class="mt-4 flex gap-3">
      <button type="submit" form="graph-settings" disabled={saving} class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50">
        {saving ? '⏳ Saving...' : 'Save'}
      </button>
      <form method="POST" action="?/sync" use:syncingEnhance>
        <button type="submit" disabled={syncing} class="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-600 hover:border-zinc-400 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-500 dark:hover:text-white disabled:opacity-50">
          {syncing ? '⏳ Syncing...' : 'Sync from Git'}
        </button>
      </form>
      <form method="POST" action="?/pushToGit" use:pushingEnhance>
        <button type="submit" disabled={pushing} class="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-600 hover:border-zinc-400 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-500 dark:hover:text-white disabled:opacity-50">
          {pushing ? '⏳ Pushing...' : 'Push to Git'}
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
              <p class="font-mono text-xs text-zinc-500">{s.organization.urn}</p>
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
          class="{inputClass} font-mono" />
      </div>
      <div>
        <label for="subRole" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">Role</label>
        <select id="subRole" name="role" class="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white">
          <option value="READER">Reader</option>
          <option value="CONTRIBUTOR">Contributor</option>
        </select>
      </div>
      <button type="submit" class="rounded-lg bg-zinc-200 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-300 dark:bg-zinc-700 dark:text-white dark:hover:bg-zinc-600">Add</button>
    </form>
  </section>
</div>
