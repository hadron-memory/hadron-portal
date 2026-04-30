<script lang="ts">
  import { enhance } from '$app/forms';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import { toSlug } from '$lib/slug';
  import type { App } from '$lib/types';
  import type { PageData, ActionData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const org = $derived(data.org);
  const apps = $derived(data.apps);

  function activeKeyCount(app: App): number {
    return app.keys.filter((k) => !k.revokedAt).length;
  }

  let showCreate = $state(false);
  let name = $state('');
  let appSlug = $state('');
  let slugEdited = $state(false);
  let appType = $state<'WORKSTATION' | 'CHATBOT' | 'AGENT' | 'AUTOMATION' | 'CLOUD' | 'IOT'>('WORKSTATION');
  let createUserPermission = $state<'DENY' | 'EXPLICIT' | 'IMPLICIT'>('EXPLICIT');
  let identifyUserMethod = $state<'USER_ID' | 'SECRET'>('USER_ID');
  let sessionTimeoutSeconds = $state(900);
  let anonymousTtlDays = $state(7);

  $effect(() => {
    if (!slugEdited) appSlug = toSlug(name);
  });

  const inputClass = "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500";
</script>

<svelte:head><title>Apps · {org.name} · Hadron</title></svelte:head>

<div class="space-y-6">
  <div>
    <Breadcrumb items={[
      { label: 'Organizations', href: '/app/orgs' },
      { label: org.name, href: `/app/orgs/${org.id}` },
      { label: 'Apps' },
    ]} />
    <div class="mt-2 flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold text-zinc-900 dark:text-white">Apps</h1>
        <p class="mt-1 text-sm text-zinc-500">Third-party applications that call Hadron on behalf of their own users (Micromentor, websites, mobile apps, etc).</p>
      </div>
      {#if !showCreate}
        <button type="button" onclick={() => { showCreate = true; }}
          class="rounded-lg px-4 py-2 text-sm font-semibold text-white" style="background: #fb8500;">
          + New App
        </button>
      {/if}
    </div>
  </div>

  {#if form?.error}
    <div class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{form.error}</div>
  {/if}

  {#if showCreate}
    <div class="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 class="mb-4 text-lg font-semibold text-zinc-900 dark:text-white">Create an App</h2>
      <form method="POST" action="?/create" use:enhance class="space-y-4">
        <div>
          <label for="name" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Name</label>
          <input id="name" type="text" name="name" required placeholder="e.g. Micromentor Backend"
            bind:value={name} class={inputClass} />
          <p class="mt-1 text-xs text-zinc-400">Identifies the calling application in audit logs and the portal.</p>
        </div>
        <div>
          <label for="appSlug" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">URN</label>
          <div class="flex items-stretch">
            <span class="inline-flex items-center rounded-l-lg border border-r-0 border-zinc-300 bg-zinc-100 px-3 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">{org.urn}:</span>
            <input id="appSlug" type="text" name="urn" required placeholder="mmdata"
              bind:value={appSlug}
              oninput={() => { slugEdited = true; }}
              class="w-full rounded-r-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500" />
          </div>
          <p class="mt-1 text-xs text-zinc-400">Auto-derived from the name. Can be customized. Must be unique within the org.</p>
        </div>

        <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label for="appType" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Type</label>
            <select id="appType" name="appType" bind:value={appType}
              class="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white w-full">
              <option value="WORKSTATION">💻 Workstation</option>
              <option value="CHATBOT">💬 Chatbot</option>
              <option value="AGENT">🤖 Agent</option>
              <option value="AUTOMATION">⚙️ Automation</option>
              <option value="CLOUD">☁️ Cloud</option>
              <option value="IOT">📡 IoT</option>
            </select>
            <p class="mt-1 text-xs text-zinc-400">Surface the App targets. Affects how it is presented and which UX flows apply.</p>
          </div>
          <div>
            <label for="cup" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">User creation</label>
            <select id="cup" name="createUserPermission" bind:value={createUserPermission}
              class="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white w-full">
              <option value="DENY">DENY — cannot create users</option>
              <option value="EXPLICIT">EXPLICIT — must call createAppUser first</option>
              <option value="IMPLICIT">IMPLICIT — auto-create on first use</option>
            </select>
          </div>
          <div>
            <label for="ium" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Identify user by</label>
            <select id="ium" name="identifyUserMethod" bind:value={identifyUserMethod}
              class="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white w-full">
              <option value="USER_ID">USER_ID — app sends externalUserId (Tier 2)</option>
              <option value="SECRET">SECRET — app provides per-user data key (Tier 2.5, Phase 2)</option>
            </select>
          </div>
          <div>
            <label for="timeout" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Session timeout (seconds)</label>
            <input id="timeout" type="number" name="sessionTimeoutSeconds"
              bind:value={sessionTimeoutSeconds} min="60" max="86400" class={inputClass} />
            <p class="mt-1 text-xs text-zinc-400">Default 900 (15 min). Max 86400 (24h).</p>
          </div>
          <div>
            <label for="anonttl" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Anonymous memory TTL (days)</label>
            <input id="anonttl" type="number" name="anonymousTtlDays"
              bind:value={anonymousTtlDays} min="1" max="90" class={inputClass} />
            <p class="mt-1 text-xs text-zinc-400">How long an unlinked anonymous session's memory is kept.</p>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <button type="submit" disabled={!name.trim()}
            class="rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            style="background: #fb8500;">
            Create App
          </button>
          <button type="button" onclick={() => { showCreate = false; name = ''; }}
            class="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
            Cancel
          </button>
        </div>
      </form>
    </div>
  {/if}

  {#if apps.length === 0 && !showCreate}
    <div class="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 p-8 text-center dark:border-zinc-700 dark:bg-zinc-900/50">
      <p class="text-sm text-zinc-500">No apps yet.</p>
      <p class="mt-1 text-xs text-zinc-400">An App represents a third-party system that calls Hadron with an App Key. Create one when you're ready to integrate Juno, a website chatbot, or any other multi-user agent.</p>
    </div>
  {/if}

  {#each apps as app (app.id)}
    <div class="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <div class="flex items-start justify-between">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <a href="/app/orgs/{org.id}/apps/{app.id}" class="text-lg font-semibold text-indigo-600 hover:underline dark:text-indigo-300">
              {app.name}
            </a>
            <span class="rounded bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
              {app.identifyUserMethod}
            </span>
            <span class="rounded bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
              {app.createUserPermission}
            </span>
          </div>
          <div class="mt-1">
            <Urn value={app.urn} type="app" />
          </div>
          <div class="mt-2 flex flex-wrap gap-4 text-xs text-zinc-500">
            <span>{activeKeyCount(app)} active key{activeKeyCount(app) !== 1 ? 's' : ''}</span>
            <span>{app.agents.length} agent{app.agents.length !== 1 ? 's' : ''}</span>
            <span>Session timeout: {Math.round(app.sessionTimeoutSeconds / 60)}m</span>
            <span>Anon TTL: {app.anonymousTtlDays}d</span>
          </div>
          {#if app.agents.length > 0}
            <div class="mt-2 flex flex-wrap gap-1">
              {#each app.agents as a}
                <span class="rounded bg-indigo-50 px-1.5 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">{a.name}</span>
              {/each}
            </div>
          {/if}
        </div>
        <div class="flex items-center gap-2">
          <a href="/app/orgs/{org.id}/apps/{app.id}"
            class="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
            Manage
          </a>
          <form method="POST" action="?/delete" use:enhance
            onsubmit={(e) => { if (!confirm(`Delete app "${app.name}"? Active keys will be revoked and sessions invalidated.`)) e.preventDefault(); }}>
            <input type="hidden" name="id" value={app.id} />
            <button type="submit" class="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950">
              Delete
            </button>
          </form>
        </div>
      </div>
    </div>
  {/each}
</div>
