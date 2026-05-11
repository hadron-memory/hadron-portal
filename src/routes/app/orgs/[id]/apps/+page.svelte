<script lang="ts">
  import { enhance } from '$app/forms';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import { installStrings } from '$lib/i18n/install-strings';
  import type { App } from '$lib/types';
  import type { PageData, ActionData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const org = $derived(data.org);
  const apps = $derived(data.apps);

  function activeKeyCount(app: App): number {
    return app.keys.filter((k) => !k.revokedAt).length;
  }
</script>

<svelte:head><title>Apps · {org.name} · Hadron</title></svelte:head>

<div class="space-y-6">
  <div>
    <Breadcrumb items={[
      { label: 'Apps' },
    ]} />
    <div class="mt-2">
      <h1 class="text-2xl font-bold text-zinc-900 dark:text-white">Apps</h1>
      <p class="mt-1 text-sm text-zinc-500">Installed Agents that authenticate clients (Micromentor, websites, mobile apps, the coding-agent CLI). Each App is a deployment of an Agent.</p>
    </div>
  </div>

  {#if form?.error}
    <div class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">{form.error}</div>
  {/if}

  {#if apps.length === 0}
    <!-- 009-install-agent-flow FR-011 / T019: Apps page is list-only.
         Empty-state copy directs the user to the Agents list to install. -->
    <div class="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 p-8 text-center dark:border-zinc-700 dark:bg-zinc-900/50">
      <p class="text-sm text-zinc-500">{installStrings.emptyAppsPage()}</p>
      <a href="/app/orgs/{org.id}/agents" class="mt-3 inline-block rounded-lg px-4 py-2 text-sm font-semibold text-white" style="background: #fb8500;">
        Browse Agents
      </a>
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
            <span>Session timeout: {Math.round(app.sessionTimeoutSeconds / 60)}m</span>
            <span>Anon TTL: {app.anonymousTtlDays}d</span>
          </div>
          {#if app.agent}
            <div class="mt-2 text-xs text-zinc-500">
              Agent: <span class="font-medium text-indigo-600 dark:text-indigo-300">{app.agent.name}</span>
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
