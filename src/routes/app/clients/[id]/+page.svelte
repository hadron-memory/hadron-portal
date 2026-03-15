<script lang="ts">
  import { enhance } from '$app/forms';
  import { goto } from '$app/navigation';
  import type { PageData, ActionData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const client = $derived(data.client);

  // Collect accessible bundles from orgs for the subscribe dropdown
  const subscribedBundleIds = $derived(new Set((client.bundleSubscriptions ?? []).map((s) => s.bundle.id)));
  const availableBundles = $derived(
    (data.orgs ?? []).flatMap((o) => o.graphBundles ?? []).filter((b) => !subscribedBundleIds.has(b.id))
  );

  const typeIcon: Record<string, string> = { WORKSTATION: '💻', CLOUD: '☁️', IOT: '📡', AGENT: '🤖' };

  let copied = $state(false);
  async function copyKey(key: string) {
    await navigator.clipboard.writeText(key);
    copied = true;
    setTimeout(() => (copied = false), 2000);
  }

  let editingSubId = $state<string | null>(null);
</script>

<svelte:head><title>{client.label} · Hadron</title></svelte:head>

<div class="space-y-8">
  <div class="flex items-start justify-between">
    <div>
      <a href="/app/clients" class="text-sm text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white">← Clients</a>
      <h1 class="mt-1 flex items-center gap-2 text-2xl font-bold text-zinc-900 dark:text-white">
        <span>{typeIcon[client.clientType] ?? '🔑'}</span>
        {client.label}
      </h1>
      {#if client.user}
        <p class="text-sm text-zinc-500">Owned by {client.user.name ?? client.user.githubUsername ?? client.user.email}</p>
      {/if}
    </div>
    <form method="POST" action="?/revoke" use:enhance onsubmit={(e) => {
      if (!confirm(`Delete client "${client.label}"? The API key will stop working immediately. This cannot be undone.`)) e.preventDefault();
      else goto('/app/clients');
    }}>
      <button type="submit" class="rounded-md border border-red-800 px-3 py-1.5 text-sm text-red-400 hover:bg-red-950">Delete</button>
    </form>
  </div>

  {#if form?.error}
    <div class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{form.error}</div>
  {/if}

  <!-- Details -->
  <section class="grid gap-3 text-sm sm:grid-cols-2">
    <div class="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <p class="text-xs text-zinc-500">Type</p>
      <p class="mt-1 font-medium text-zinc-900 dark:text-white">{client.clientType}</p>
    </div>
    <div class="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <p class="text-xs text-zinc-500">Role</p>
      <p class="mt-1 font-medium text-zinc-900 dark:text-white">{client.role}</p>
    </div>
    {#if client.expiresAt}
      <div class="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <p class="text-xs text-zinc-500">Expires</p>
        <p class="mt-1 font-medium text-yellow-600 dark:text-yellow-300">{new Date(client.expiresAt).toLocaleDateString()}</p>
      </div>
    {/if}
    <div class="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <p class="text-xs text-zinc-500">Created</p>
      <p class="mt-1 text-zinc-900 dark:text-white">{new Date(client.createdAt).toLocaleDateString()}</p>
    </div>
    {#if client.lastUsedAt}
      <div class="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <p class="text-xs text-zinc-500">Last used</p>
        <p class="mt-1 text-zinc-900 dark:text-white">{new Date(client.lastUsedAt).toLocaleDateString()}</p>
      </div>
    {/if}
  </section>

  <!-- API Key -->
  <section>
    <h2 class="mb-3 font-semibold text-zinc-900 dark:text-white">API Key</h2>
    {#if data.newKey}
      <p class="mb-2 text-sm text-amber-700 dark:text-yellow-400">
        Save this key now — it won't be shown again after you leave this page.
      </p>
    {/if}
    <div class="flex items-center gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
      <code class="flex-1 break-all font-mono text-sm text-zinc-900 dark:text-zinc-100">
        {data.newKey ? data.newKey : '••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••'}
      </code>
      {#if data.newKey}
        <button
          onclick={() => copyKey(data.newKey ?? '')}
          class="shrink-0 rounded border border-zinc-300 px-3 py-1.5 text-xs text-zinc-600 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      {:else}
        <form method="POST" action="?/regenerate" use:enhance>
          <button type="submit" class="shrink-0 rounded border border-zinc-300 px-3 py-1.5 text-xs text-zinc-600 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
            Regenerate key
          </button>
        </form>
      {/if}
    </div>
  </section>

  <!-- Bundle subscriptions -->
  <section>
    <h2 class="mb-4 font-semibold text-zinc-900 dark:text-white">Graph Bundle Subscriptions
      <span class="ml-1 text-sm font-normal text-zinc-500">({client.bundleSubscriptions?.length ?? 0})</span>
    </h2>

    {#if client.bundleSubscriptions?.length}
      <div class="mb-4 divide-y divide-zinc-200 rounded-xl border border-zinc-200 overflow-hidden dark:divide-zinc-800 dark:border-zinc-800">
        {#each client.bundleSubscriptions as sub (sub.id)}
          {#if editingSubId === sub.id}
            <div class="bg-white px-5 py-4 dark:bg-zinc-900">
              <div class="mb-3 flex items-center justify-between">
                <p class="font-mono text-sm font-medium text-indigo-600 dark:text-indigo-300">{sub.bundle.name}</p>
                <form method="POST" action="?/unsubscribe" use:enhance onsubmit={() => { editingSubId = null; }}>
                  <input type="hidden" name="bundleId" value={sub.bundle.id} />
                  <button type="submit" class="text-xs text-red-400 hover:text-red-300">Remove</button>
                </form>
              </div>
              <form method="POST" action="?/subscribe" use:enhance onsubmit={() => { editingSubId = null; }}>
                <input type="hidden" name="bundleId" value={sub.bundle.id} />
                <div class="flex flex-wrap items-end gap-3">
                  <div>
                    <label class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">Access</label>
                    <select name="subscriptionType" value={sub.subscriptionType} class="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white">
                      <option value="READ_ONLY">Read Only</option>
                      <option value="READ_WRITE">Read/Write</option>
                    </select>
                  </div>
                  <div>
                    <label class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">Training mode</label>
                    <select name="trainingMode" value={sub.trainingMode ? 'true' : 'false'} class="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white">
                      <option value="false">Off</option>
                      <option value="true">On</option>
                    </select>
                  </div>
                  <button type="submit" class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">Save</button>
                  <button type="button" onclick={() => { editingSubId = null; }} class="px-3 py-2 text-sm text-zinc-500 hover:text-zinc-300">Cancel</button>
                </div>
              </form>
            </div>
          {:else}
            <button
              type="button"
              onclick={() => { editingSubId = sub.id; }}
              class="flex w-full items-center gap-4 bg-white px-5 py-4 text-left transition hover:bg-zinc-50 dark:bg-zinc-900 dark:hover:bg-zinc-800/50"
            >
              <div class="flex-1 min-w-0">
                <p class="font-mono text-sm font-medium text-indigo-600 dark:text-indigo-300">{sub.bundle.name}</p>
                <p class="text-xs text-zinc-500">
                  {sub.subscriptionType === 'READ_WRITE' ? 'Read/Write' : 'Read Only'}
                  {#if sub.trainingMode} · Training mode{/if}
                </p>
              </div>
              <span class="text-xs text-zinc-400">Edit</span>
            </button>
          {/if}
        {/each}
      </div>
    {:else}
      <p class="mb-4 text-sm text-zinc-500">No graph bundle subscriptions yet.</p>
    {/if}

    <h3 class="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">Add subscription</h3>
    {#if availableBundles.length > 0}
      <form method="POST" action="?/subscribe" use:enhance class="flex flex-wrap items-end gap-3">
        <div>
          <label for="bundleId" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">Bundle</label>
          <select id="bundleId" name="bundleId" class="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm text-white">
            {#each availableBundles as b (b.id)}
              <option value={b.id}>{b.name}</option>
            {/each}
          </select>
        </div>
        <div>
          <label for="subscriptionType" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">Access</label>
          <select id="subscriptionType" name="subscriptionType" class="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white">
            <option value="READ_ONLY">Read Only</option>
            <option value="READ_WRITE">Read/Write</option>
          </select>
        </div>
        <div>
          <label for="trainingMode" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">Training mode</label>
          <select id="trainingMode" name="trainingMode" class="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white">
            <option value="false">Off</option>
            <option value="true">On</option>
          </select>
        </div>
        <button type="submit" class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">Subscribe</button>
      </form>
    {:else}
      <p class="text-sm text-zinc-500">All available bundles are already subscribed. Create new bundles on the organization page.</p>
    {/if}
  </section>
</div>
