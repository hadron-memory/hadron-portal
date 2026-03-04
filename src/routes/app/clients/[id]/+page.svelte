<script lang="ts">
  import { enhance } from '$app/forms';
  import { goto } from '$app/navigation';
  import type { PageData, ActionData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const client = $derived(data.client);

  // Collect all accessible graphs from orgs (for the subscribe dropdown)
  const subscribedIds = $derived(new Set((client.graphs ?? []).map((g) => g.id)));
  const availableGraphs = $derived(
    (data.orgs ?? []).flatMap((o) => o.graphs ?? []).filter((g) => !subscribedIds.has(g.id))
  );

  const typeIcon: Record<string, string> = { WORKSTATION: '💻', CLOUD: '☁️', IOT: '📡', AGENT: '🤖' };

  let copied = $state(false);
  async function copyKey(key: string) {
    await navigator.clipboard.writeText(key);
    copied = true;
    setTimeout(() => (copied = false), 2000);
  }
</script>

<svelte:head><title>{client.label} · Hadron</title></svelte:head>

<div class="space-y-8">
  <div class="flex items-start justify-between">
    <div>
      <a href="/app/clients" class="text-sm text-zinc-400 hover:text-white">← Clients</a>
      <h1 class="mt-1 flex items-center gap-2 text-2xl font-bold text-white">
        <span>{typeIcon[client.type] ?? '🔑'}</span>
        {client.label}
      </h1>
      {#if client.user}
        <p class="text-sm text-zinc-500">Owned by {client.user.name ?? client.user.login}</p>
      {/if}
    </div>
    <form method="POST" action="?/revoke" use:enhance onsubmit={(e) => {
      if (!confirm(`Revoke client "${client.label}"? This cannot be undone.`)) e.preventDefault();
      else goto('/app/clients');
    }}>
      <button type="submit" class="rounded-md border border-red-800 px-3 py-1.5 text-sm text-red-400 hover:bg-red-950">Revoke</button>
    </form>
  </div>

  <!-- New key banner -->
  {#if data.newKey}
    <div class="rounded-xl border border-yellow-700 bg-yellow-950 p-5">
      <p class="mb-2 text-sm font-semibold text-yellow-300">⚠️ Copy your API key now — it won't be shown again.</p>
      <div class="flex items-center gap-3">
        <code class="flex-1 break-all rounded bg-yellow-900/50 px-3 py-2 text-xs text-yellow-200">{data.newKey}</code>
        <button onclick={() => copyKey(data.newKey ?? '')} class="shrink-0 rounded border border-yellow-700 px-3 py-1.5 text-xs text-yellow-300 hover:bg-yellow-900">
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
    </div>
  {/if}

  {#if form?.error}
    <div class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{form.error}</div>
  {/if}

  <!-- Details -->
  <section class="grid gap-3 text-sm sm:grid-cols-2">
    <div class="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
      <p class="text-xs text-zinc-500">Type</p>
      <p class="mt-1 font-medium text-white">{client.type}</p>
    </div>
    <div class="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
      <p class="text-xs text-zinc-500">Roles</p>
      <p class="mt-1 font-medium text-white">{client.roles?.join(', ')}</p>
    </div>
    {#if client.namespace}
      <div class="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
        <p class="text-xs text-zinc-500">Namespace restriction</p>
        <p class="mt-1 font-mono text-sm text-white">{client.namespace}</p>
      </div>
    {/if}
    {#if client.expiresAt}
      <div class="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
        <p class="text-xs text-zinc-500">Expires</p>
        <p class="mt-1 font-medium text-yellow-300">{new Date(client.expiresAt).toLocaleDateString()}</p>
      </div>
    {/if}
    <div class="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
      <p class="text-xs text-zinc-500">Created</p>
      <p class="mt-1 text-white">{new Date(client.createdAt).toLocaleDateString()}</p>
    </div>
    {#if client.lastUsedAt}
      <div class="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
        <p class="text-xs text-zinc-500">Last used</p>
        <p class="mt-1 text-white">{new Date(client.lastUsedAt).toLocaleDateString()}</p>
      </div>
    {/if}
  </section>

  <!-- Graph subscriptions -->
  <section>
    <h2 class="mb-4 font-semibold text-white">Graph subscriptions
      <span class="ml-1 text-sm font-normal text-zinc-500">({client.graphs?.length ?? 0})</span>
    </h2>

    {#if client.graphs?.length}
      <div class="mb-4 divide-y divide-zinc-800 rounded-xl border border-zinc-800 overflow-hidden">
        {#each client.graphs as g (g.id)}
          <div class="flex items-center gap-4 bg-zinc-900 px-5 py-4">
            <div class="flex-1 min-w-0">
              <p class="font-mono text-sm font-medium text-indigo-300">{g.name}</p>
              {#if g.lastSyncedAt}
                <p class="text-xs text-zinc-500">synced {new Date(g.lastSyncedAt).toLocaleDateString()}</p>
              {/if}
            </div>
            <form method="POST" action="?/unsubscribe" use:enhance>
              <input type="hidden" name="graphId" value={g.id} />
              <button type="submit" class="text-xs text-red-400 hover:text-red-300">Remove</button>
            </form>
          </div>
        {/each}
      </div>
    {:else}
      <p class="mb-4 text-sm text-zinc-500">No graph subscriptions yet.</p>
    {/if}

    {#if availableGraphs.length > 0}
      <form method="POST" action="?/subscribe" use:enhance class="flex items-end gap-3 max-w-sm">
        <div class="flex-1">
          <label for="graphId" class="mb-1 block text-xs text-zinc-400">Add graph</label>
          <select id="graphId" name="graphId" class="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm text-white">
            {#each availableGraphs as g (g.id)}
              <option value={g.id}>{g.name}</option>
            {/each}
          </select>
        </div>
        <button type="submit" class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">Subscribe</button>
      </form>
    {/if}
  </section>
</div>
