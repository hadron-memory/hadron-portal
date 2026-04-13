<script lang="ts">
  import { enhance } from '$app/forms';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import type { PageData, ActionData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const app = $derived(data.app);
  const org = $derived(data.org);
  const availableAgents = $derived(data.availableAgents);

  let editMode = $state(false);
  let name = $state(app.name);
  let createUserPermission = $state(app.createUserPermission);
  let identifyUserMethod = $state(app.identifyUserMethod);
  let sessionTimeoutSeconds = $state(app.sessionTimeoutSeconds);
  let anonymousTtlDays = $state(app.anonymousTtlDays);

  let keyLabel = $state('');
  let selectedAgentId = $state('');

  // When a key is just created, show the raw key once.
  const newRawKey = $derived(form?.rawKey as string | undefined);

  function formatDate(s: string | null | undefined): string {
    if (!s) return '—';
    return new Date(s).toLocaleString();
  }

  const inputClass = "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500";
</script>

<svelte:head><title>{app.name} · Apps · {org.name} · Hadron</title></svelte:head>

<div class="space-y-6">
  <div>
    <Breadcrumb items={[
      { label: 'Organizations', href: '/app/orgs' },
      { label: org.name, href: `/app/orgs/${org.id}` },
      { label: 'Apps', href: `/app/orgs/${org.id}/apps` },
      { label: app.name },
    ]} />
    <h1 class="mt-2 text-2xl font-bold text-zinc-900 dark:text-white">{app.name}</h1>
    <p class="mt-1 font-mono text-xs text-zinc-400">App ID: {app.id}</p>
  </div>

  {#if form?.error}
    <div class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{form.error}</div>
  {/if}
  {#if form?.updated}
    <div class="rounded-lg border border-green-800 bg-green-950 px-4 py-3 text-sm text-green-300">Saved.</div>
  {/if}

  {#if newRawKey}
    <div class="rounded-xl border-2 border-amber-400 bg-amber-50 p-4 dark:border-amber-500 dark:bg-amber-950/30">
      <h3 class="mb-2 text-sm font-semibold text-amber-900 dark:text-amber-200">Save this key — it will not be shown again</h3>
      <div class="flex items-center gap-2">
        <code class="flex-1 overflow-x-auto rounded bg-white px-3 py-2 font-mono text-xs text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100">{newRawKey}</code>
        <button type="button"
          onclick={() => { navigator.clipboard.writeText(newRawKey); }}
          class="rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-600">
          Copy
        </button>
      </div>
      <p class="mt-2 text-xs text-amber-800 dark:text-amber-300">
        This is an App Key. It lives in your backend server as an environment variable.
        Never embed it in a browser, mobile app, or client-side code. Anyone with this key
        can impersonate any user of this app.
      </p>
    </div>
  {/if}

  <!-- Settings -->
  <div class="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
    <div class="mb-3 flex items-center justify-between">
      <h2 class="text-lg font-semibold text-zinc-900 dark:text-white">Settings</h2>
      {#if !editMode}
        <button type="button" onclick={() => { editMode = true; }}
          class="rounded-lg border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
          Edit
        </button>
      {/if}
    </div>

    {#if editMode}
      <form method="POST" action="?/update" use:enhance={() => {
        return async ({ update }) => { editMode = false; await update(); };
      }} class="space-y-4">
        <div>
          <label for="name" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Name</label>
          <input id="name" type="text" name="name" bind:value={name} class={inputClass} />
        </div>
        <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label for="cup" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">User creation</label>
            <select id="cup" name="createUserPermission" bind:value={createUserPermission}
              class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white">
              <option value="DENY">DENY</option>
              <option value="EXPLICIT">EXPLICIT</option>
              <option value="IMPLICIT">IMPLICIT</option>
            </select>
          </div>
          <div>
            <label for="ium" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Identify user by</label>
            <select id="ium" name="identifyUserMethod" bind:value={identifyUserMethod}
              class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white">
              <option value="USER_ID">USER_ID</option>
              <option value="SECRET">SECRET</option>
            </select>
          </div>
          <div>
            <label for="timeout" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Session timeout (seconds)</label>
            <input id="timeout" type="number" name="sessionTimeoutSeconds"
              bind:value={sessionTimeoutSeconds} min="60" max="86400" class={inputClass} />
          </div>
          <div>
            <label for="anonttl" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Anonymous TTL (days)</label>
            <input id="anonttl" type="number" name="anonymousTtlDays"
              bind:value={anonymousTtlDays} min="1" max="90" class={inputClass} />
          </div>
        </div>
        <div class="flex gap-2">
          <button type="submit" class="rounded-lg px-4 py-2 text-sm font-semibold text-white" style="background: #fb8500;">Save</button>
          <button type="button" onclick={() => {
            editMode = false;
            name = app.name;
            createUserPermission = app.createUserPermission;
            identifyUserMethod = app.identifyUserMethod;
            sessionTimeoutSeconds = app.sessionTimeoutSeconds;
            anonymousTtlDays = app.anonymousTtlDays;
          }} class="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
            Cancel
          </button>
        </div>
      </form>
    {:else}
      <dl class="grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
        <div>
          <dt class="text-xs font-medium text-zinc-500">User creation</dt>
          <dd class="text-zinc-900 dark:text-zinc-200">{app.createUserPermission}</dd>
        </div>
        <div>
          <dt class="text-xs font-medium text-zinc-500">Identify user by</dt>
          <dd class="text-zinc-900 dark:text-zinc-200">{app.identifyUserMethod}</dd>
        </div>
        <div>
          <dt class="text-xs font-medium text-zinc-500">Session timeout</dt>
          <dd class="text-zinc-900 dark:text-zinc-200">{app.sessionTimeoutSeconds} seconds</dd>
        </div>
        <div>
          <dt class="text-xs font-medium text-zinc-500">Anonymous TTL</dt>
          <dd class="text-zinc-900 dark:text-zinc-200">{app.anonymousTtlDays} days</dd>
        </div>
      </dl>
    {/if}
  </div>

  <!-- Agents -->
  <div class="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
    <h2 class="mb-3 text-lg font-semibold text-zinc-900 dark:text-white">Agents</h2>
    <p class="mb-3 text-sm text-zinc-500">Agents this App is allowed to operate. An App Key holder can only call startAgentSession for these.</p>

    {#if app.agents.length === 0}
      <p class="mb-3 text-sm text-zinc-400">No agents attached yet.</p>
    {:else}
      <ul class="mb-4 space-y-2">
        {#each app.agents as agent (agent.id)}
          <li class="flex items-center justify-between rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800">
            <div>
              <span class="font-medium text-zinc-900 dark:text-zinc-100">{agent.name}</span>
              <span class="ml-2 font-mono text-xs text-zinc-400">{agent.urn}</span>
            </div>
            <form method="POST" action="?/removeAgent" use:enhance>
              <input type="hidden" name="agentId" value={agent.id} />
              <button type="submit"
                class="rounded-lg border border-red-300 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950">
                Remove
              </button>
            </form>
          </li>
        {/each}
      </ul>
    {/if}

    {#if availableAgents.length > 0}
      <form method="POST" action="?/addAgent" use:enhance class="flex items-end gap-2">
        <div class="flex-1">
          <label for="agentId" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Add an agent</label>
          <select id="agentId" name="agentId" bind:value={selectedAgentId}
            class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white">
            <option value="">Select…</option>
            {#each availableAgents as a}
              <option value={a.id}>{a.name} ({a.urn})</option>
            {/each}
          </select>
        </div>
        <button type="submit" disabled={!selectedAgentId}
          class="rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          style="background: #219ebc;">
          Attach
        </button>
      </form>
    {/if}
  </div>

  <!-- Keys -->
  <div class="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
    <h2 class="mb-3 text-lg font-semibold text-zinc-900 dark:text-white">App Keys</h2>
    <p class="mb-4 text-sm text-zinc-500">
      App Keys are long-lived server secrets. Store them in your backend environment —
      never in client-side code.
    </p>

    <form method="POST" action="?/createKey" use:enhance class="mb-5 flex items-end gap-2">
      <div class="flex-1">
        <label for="label" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Label (optional)</label>
        <input id="label" type="text" name="label" placeholder="e.g. production-backend"
          bind:value={keyLabel} class={inputClass} />
      </div>
      <button type="submit"
        class="rounded-lg px-4 py-2 text-sm font-semibold text-white" style="background: #fb8500;">
        + Generate Key
      </button>
    </form>

    {#if app.keys.length === 0}
      <p class="text-sm text-zinc-400">No keys yet.</p>
    {:else}
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-zinc-200 dark:border-zinc-800">
            <th class="pb-2 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">Label</th>
            <th class="pb-2 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">Preview</th>
            <th class="pb-2 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">Created</th>
            <th class="pb-2 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">Last used</th>
            <th class="pb-2"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-zinc-100 dark:divide-zinc-800">
          {#each app.keys as key (key.id)}
            <tr class={key.revokedAt ? 'opacity-50' : ''}>
              <td class="py-2 text-zinc-900 dark:text-zinc-200">{key.label ?? '—'}</td>
              <td class="py-2 font-mono text-xs text-zinc-500">{key.keyPreview}</td>
              <td class="py-2 text-xs text-zinc-500">{formatDate(key.createdAt)}</td>
              <td class="py-2 text-xs text-zinc-500">{formatDate(key.lastUsedAt)}</td>
              <td class="py-2 text-right">
                {#if key.revokedAt}
                  <span class="text-xs text-red-500">revoked</span>
                {:else}
                  <form method="POST" action="?/revokeKey" use:enhance
                    onsubmit={(e) => { if (!confirm('Revoke this key? This cannot be undone.')) e.preventDefault(); }}>
                    <input type="hidden" name="id" value={key.id} />
                    <button type="submit"
                      class="rounded border border-red-300 px-2 py-0.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950">
                      Revoke
                    </button>
                  </form>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>
</div>
