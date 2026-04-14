<script lang="ts">
  import Urn from '$lib/components/Urn.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  let search = $state('');

  interface Row {
    id: string;
    name: string;
    urn: string;
    orgId: string;
    orgName: string;
    orgUrn: string;
    identifyUserMethod: string;
    createUserPermission: string;
    agentCount: number;
    activeKeyCount: number;
    sessionTimeoutSeconds: number;
  }

  // Flatten apps from all orgs
  const allApps = $derived.by<Row[]>(() => {
    const out: Row[] = [];
    for (const org of data.orgs) {
      for (const app of org.apps ?? []) {
        out.push({
          id: app.id,
          name: app.name,
          urn: app.urn,
          orgId: org.id,
          orgName: org.name,
          orgUrn: org.urn,
          identifyUserMethod: app.identifyUserMethod,
          createUserPermission: app.createUserPermission,
          agentCount: app.agents?.length ?? 0,
          activeKeyCount: (app.keys ?? []).filter((k) => !k.revokedAt).length,
          sessionTimeoutSeconds: app.sessionTimeoutSeconds,
        });
      }
    }
    return out;
  });

  const filtered = $derived(
    allApps.filter((a) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return a.name.toLowerCase().includes(q) ||
        a.orgName.toLowerCase().includes(q);
    }).sort((a, b) => a.name.localeCompare(b.name))
  );
</script>

<svelte:head><title>Apps · Hadron</title></svelte:head>

<div class="space-y-6">
  <div>
    <h1 class="text-2xl font-bold text-zinc-900 dark:text-white">Apps</h1>
    <p class="mt-1 text-sm text-zinc-500">
      Third-party applications that call Hadron on behalf of their own users
      (e.g. Micromentor, a website chatbot, a mobile app). Each App holds an
      App Key that grants access to a specific set of agents.
    </p>
  </div>

  {#if allApps.length > 0}
    <div>
      <input
        type="text"
        placeholder="Search apps..."
        bind:value={search}
        class="w-full max-w-md rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500"
      />
    </div>
  {/if}

  {#if allApps.length === 0}
    <div class="rounded-xl border border-zinc-200 bg-white p-12 text-center text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
      No apps yet. Create one from an organization's Apps page.
    </div>
  {:else if filtered.length === 0}
    <div class="rounded-xl border border-zinc-200 bg-white p-12 text-center text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
      No apps match "{search}".
    </div>
  {:else}
    <div class="space-y-3">
      {#each filtered as app (app.id)}
        <a
          href="/app/orgs/{app.orgId}/apps/{app.id}"
          class="flex items-center gap-4 rounded-xl border border-zinc-200 bg-white p-5 transition hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600"
        >
          <div class="flex-1 min-w-0">
            <p class="text-sm font-semibold text-indigo-600 dark:text-indigo-300">{app.name}</p>
            <Urn value={app.urn} type="app" />
            <div class="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
              <span>{app.orgName}</span>
              <span class="text-zinc-300 dark:text-zinc-700">·</span>
              <span>{app.agentCount} agent{app.agentCount !== 1 ? 's' : ''}</span>
              <span class="text-zinc-300 dark:text-zinc-700">·</span>
              <span>{app.activeKeyCount} active key{app.activeKeyCount !== 1 ? 's' : ''}</span>
              <span class="text-zinc-300 dark:text-zinc-700">·</span>
              <span class="rounded bg-zinc-100 px-2 py-0.5 font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">{app.identifyUserMethod}</span>
              <span class="rounded bg-zinc-100 px-2 py-0.5 font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">{app.createUserPermission}</span>
            </div>
          </div>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="shrink-0 text-zinc-400"><polyline points="9 18 15 12 9 6"></polyline></svg>
        </a>
      {/each}
    </div>
  {/if}
</div>
