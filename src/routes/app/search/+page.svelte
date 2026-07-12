<script lang="ts">
  import type { PageData } from './$types';
  import Urn from '$lib/components/Urn.svelte';
  import { t } from '$lib/i18n/t';

  let { data }: { data: PageData } = $props();

  // Friendly label + badge tint per entity type.
  const TYPE_META: Record<string, { label: string; cls: string }> = {
    organization: { label: 'Org', cls: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300' },
    memory: { label: 'Memory', cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
    node: { label: 'Node', cls: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300' },
    agent: { label: 'Agent', cls: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' },
    app: { label: 'App', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
    aiServiceConfig: { label: 'AI Config', cls: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300' },
    user: { label: 'User', cls: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200' },
  };

  function typeMeta(entityType: string) {
    return (
      TYPE_META[entityType] ?? {
        label: entityType,
        cls: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200',
      }
    );
  }

  // Build the canonical portal path directly from the ids each hit already
  // carries (mirrors the server resolver's canonicalPath) — no extra /app/u
  // resolver hop. Falls back to /app/u/<urn> for kinds without a direct page.
  function hitHref(h: {
    entityType: string;
    id: string;
    urn: string | null;
    memoryId: string | null;
    organizationId: string | null;
  }): string | null {
    switch (h.entityType) {
      case 'organization':
        return `/app/orgs/${h.id}`;
      case 'memory':
        return `/app/memories/${h.id}`;
      case 'node':
        return h.memoryId ? `/app/memories/${h.memoryId}/nodes/${h.id}` : null;
      case 'agent':
        return `/app/agents/${h.id}`;
      case 'app':
        return h.organizationId ? `/app/orgs/${h.organizationId}/apps/${h.id}` : null;
      case 'aiServiceConfig':
        return h.organizationId ? `/app/orgs/${h.organizationId}/integrations` : null;
      case 'user':
        // #533: PK-scoped profile page. Link by id (not urn) so handle-less
        // users — whose urn is null — stay clickable.
        return `/app/user/${h.id}`;
      default:
        // Any future kind without a direct page: resolver fallback if URN'd.
        return h.urn ? `/app/u/${encodeURIComponent(h.urn)}` : null;
    }
  }
</script>

<svelte:head><title>{data.q ? `${t('app.search.title', 'Search')}: ${data.q}` : t('app.search.title', 'Search')} · Hadron</title></svelte:head>

<div class="space-y-6">
  <div>
    <h1 class="text-2xl font-bold text-zinc-900 dark:text-white">{t('app.search.title', 'Search')}</h1>
    <p class="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
      {t('app.search.description', 'Find organizations, memories, nodes, agents, apps, AI configs, and users by name, URN, or id.')}
    </p>
  </div>

  <form method="GET" action="/app/search" class="flex gap-2">
    <!-- Preserve any active type/field filters across a new query submission. -->
    {#each data.types as type}
      <input type="hidden" name="type" value={type} />
    {/each}
    {#each data.fields as field}
      <input type="hidden" name="field" value={field} />
    {/each}
    <input
      type="search"
      name="q"
      value={data.q}
      placeholder={t('app.search.placeholder', 'Search by name, URN, or id…')}
      autocomplete="off"
      class="w-full max-w-xl rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
    />
    <button
      type="submit"
      class="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
    >
      {t('app.search.button', 'Search')}
    </button>
  </form>

  {#if data.error}
    <p class="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
      {data.error}
    </p>
  {:else if data.result}
    {#if data.result.degraded.length > 0}
      <div class="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-300">
        {#each data.result.degraded as note}
          <p>{note}</p>
        {/each}
      </div>
    {/if}

    {#if data.result.hits.length === 0}
      <p class="text-sm text-zinc-500 dark:text-zinc-400">{t('app.search.no-results', 'No results for')} “{data.q}”.</p>
    {:else}
      <p class="text-xs text-zinc-400">
        {data.result.hits.length} result{data.result.hits.length === 1 ? '' : 's'}
      </p>
      <ul class="divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {#each data.result.hits as hit}
          {@const href = hitHref(hit)}
          {@const meta = typeMeta(hit.entityType)}
          <!-- Only the name is the link; the URN chip (which has its own copy
               buttons) is a sibling, never nested inside an <a>. -->
          <li class="flex items-start gap-3 px-4 py-3 text-sm transition hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
            <span class="mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium {meta.cls}">
              {meta.label}
            </span>
            <span class="min-w-0 flex-1">
              {#if href}
                <a {href} class="block truncate font-medium text-indigo-600 hover:underline dark:text-indigo-300">
                  {hit.name ?? hit.urn ?? hit.id}
                </a>
              {:else}
                <span class="block truncate font-medium text-zinc-900 dark:text-white">
                  {hit.name ?? hit.urn ?? hit.id}
                </span>
              {/if}
              {#if hit.urn}
                <span class="mt-0.5 block"><Urn value={hit.urn} size={8} /></span>
              {/if}
              {#if hit.description}
                <span class="mt-0.5 block truncate text-xs text-zinc-500 dark:text-zinc-400">{hit.description}</span>
              {/if}
            </span>
            <span class="mt-0.5 shrink-0 text-[11px] text-zinc-400">{hit.matchedField}</span>
          </li>
        {/each}
      </ul>
    {/if}
  {:else}
    <p class="text-sm text-zinc-500 dark:text-zinc-400">{t('app.search.prompt', 'Enter a search term to begin.')}</p>
  {/if}
</div>
