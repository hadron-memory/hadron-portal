<script lang="ts">
  import { enhance } from '$app/forms';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import AgentList, { type AgentRow } from '$lib/components/AgentList.svelte';
  import type { PageData, ActionData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const app = $derived(data.app);
  const org = $derived(data.org);
  const availableAgents = $derived(data.availableAgents);

  // URN slug is everything after the org URN prefix (e.g. "mmdata" for
  // "micromentor.org:mmdata"). Fall back to the whole URN if for some reason
  // it doesn't contain a colon (shouldn't happen in practice).
  function slugOfUrn(urn: string): string {
    const idx = urn.indexOf(':');
    return idx >= 0 ? urn.slice(idx + 1) : urn;
  }

  let editMode = $state(false);
  let name = $state(app.name);
  let appSlug = $state(slugOfUrn(app.urn));
  let appType = $state(app.appType);
  let createUserPermission = $state(app.createUserPermission);
  let identifyUserMethod = $state(app.identifyUserMethod);
  let sessionTimeoutSeconds = $state(app.sessionTimeoutSeconds);
  let anonymousTtlDays = $state(app.anonymousTtlDays);

  let keyLabel = $state('');
  let selectedAgentId = $state('');

  // Rows for the <AgentList /> table, mapped from app.agents.
  const agentRows = $derived<AgentRow[]>(app.agents.map((a) => ({
    id: a.id,
    urn: a.urn,
    name: a.name,
    description: null,
    orgId: org.id,
  })));

  // Remove-agent handler uses a single hidden form that we programmatically
  // submit from the AgentList's onremove callback.
  let pendingRemoveAgentId = $state('');
  let removeAgentForm: HTMLFormElement | undefined = $state();

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
    <div class="mt-2 flex items-start justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold text-zinc-900 dark:text-white"><span class="text-zinc-400 font-normal">App:</span> {app.name}</h1>
        <div class="mt-1"><Urn value={app.urn} type="app" /></div>
      </div>
      <a href="/app/apps/{app.id}"
        class="shrink-0 rounded-lg border border-indigo-300 px-4 py-2 text-sm font-medium text-indigo-600 hover:bg-indigo-50 dark:border-indigo-700 dark:text-indigo-300 dark:hover:bg-indigo-950">
        Client setup & MCP →
      </a>
    </div>
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

  <!-- Settings (matches the layout of the Memory detail page:
       section wrapper, h2 + Edit button OUTSIDE the panel, read-only
       view as a divide-y list of full-width rows) -->
  <section class="max-w-lg">
    <div class="mb-4 flex items-center justify-between">
      <h2 class="font-semibold text-zinc-900 dark:text-white">App</h2>
      {#if !editMode}
        <button type="button" onclick={() => { editMode = true; }}
          class="rounded-md border border-zinc-300 px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800">
          Edit
        </button>
      {/if}
    </div>

    {#if editMode}
      <form method="POST" action="?/update" use:enhance={() => {
        return async ({ update }) => { editMode = false; await update(); };
      }} class="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900 space-y-4">
        <div>
          <label for="name" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Name</label>
          <input id="name" type="text" name="name" bind:value={name} class={inputClass} />
        </div>
        <div>
          <label for="urn" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">URN</label>
          <div class="flex items-stretch">
            <span class="inline-flex items-center rounded-l-lg border border-r-0 border-zinc-300 bg-zinc-100 px-3 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">{org.urn}:</span>
            <input id="urn" type="text" name="urn" bind:value={appSlug}
              class="w-full rounded-r-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white" />
          </div>
          <p class="mt-1 text-xs text-zinc-400">The slug must be unique within the organization. Changing this rewrites the URN.</p>
        </div>
        <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label for="appType" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Type</label>
            <select id="appType" name="appType" bind:value={appType}
              class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white">
              <option value="WORKSTATION">💻 Workstation</option>
              <option value="CHATBOT">💬 Chatbot</option>
              <option value="AGENT">🤖 Agent</option>
              <option value="AUTOMATION">⚙️ Automation</option>
              <option value="CLOUD">☁️ Cloud</option>
              <option value="IOT">📡 IoT</option>
            </select>
          </div>
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
            appSlug = slugOfUrn(app.urn);
            appType = app.appType;
            createUserPermission = app.createUserPermission;
            identifyUserMethod = app.identifyUserMethod;
            sessionTimeoutSeconds = app.sessionTimeoutSeconds;
            anonymousTtlDays = app.anonymousTtlDays;
          }} class="px-3 py-2 text-sm text-zinc-500 hover:text-zinc-300">
            Cancel
          </button>
        </div>
      </form>
    {:else}
      <div class="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 divide-y divide-zinc-200 dark:divide-zinc-800 overflow-hidden">
        <div class="flex items-center justify-between px-5 py-3">
          <span class="text-sm text-zinc-500">Type</span>
          <span class="text-sm font-medium text-zinc-900 dark:text-white">{app.appType}</span>
        </div>
        <div class="flex items-center justify-between px-5 py-3">
          <span class="text-sm text-zinc-500">User creation</span>
          <span class="text-sm font-medium text-zinc-900 dark:text-white">{app.createUserPermission}</span>
        </div>
        <div class="flex items-center justify-between px-5 py-3">
          <span class="text-sm text-zinc-500">Identify user by</span>
          <span class="text-sm font-medium text-zinc-900 dark:text-white">{app.identifyUserMethod}</span>
        </div>
        <div class="flex items-center justify-between px-5 py-3">
          <span class="text-sm text-zinc-500">Session timeout</span>
          <span class="text-sm font-medium text-zinc-900 dark:text-white">{app.sessionTimeoutSeconds} seconds</span>
        </div>
        <div class="flex items-center justify-between px-5 py-3">
          <span class="text-sm text-zinc-500">Anonymous TTL</span>
          <span class="text-sm font-medium text-zinc-900 dark:text-white">{app.anonymousTtlDays} days</span>
        </div>
      </div>
    {/if}
  </section>

  <!-- Agents -->
  <div class="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
    <h2 class="mb-3 text-lg font-semibold text-zinc-900 dark:text-white">Agents</h2>
    <p class="mb-3 text-sm text-zinc-500">Agents this App is allowed to operate. An App Key holder can only call startAgentSession for these.</p>

    <AgentList
      agents={agentRows}
      onremove={(agent) => { pendingRemoveAgentId = agent.id; removeAgentForm?.requestSubmit(); }}
    />

    <!-- Hidden form that the AgentList's onremove handler submits.
         Using a hidden form (vs inline per-row forms) keeps the table clean
         while still routing through SvelteKit's action layer. -->
    <form method="POST" action="?/removeAgent" use:enhance bind:this={removeAgentForm} class="hidden">
      <input type="hidden" name="agentId" value={pendingRemoveAgentId} />
    </form>


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
