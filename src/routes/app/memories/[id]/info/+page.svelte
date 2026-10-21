<script lang="ts">
  // #266: Info tab — read-only overview of the memory (owner, class, visibility,
  // description, tags, integration status, dates) + stats. Edge count, last use,
  // and "agents/apps that include this memory" need new server queries and are
  // deferred (flagged below).
  import { formatPortalDate } from '$lib/format-portal-date';
  import { t } from '$lib/i18n/t';
  import type { PageData } from './$types';
  import SyncErrorDetail from '$lib/components/SyncErrorDetail.svelte';

  let { data }: { data: PageData } = $props();
  const g = $derived(data.graph);
  const org = $derived(data.org);
  const nodeCount = $derived(data.graphNodes?.length ?? 0);

  const isAgentSystem = $derived(g.class === 'system');
  const isOwnerOnly = $derived(g.class === 'personal' || g.class === 'private');
  const visibilityLabel: Record<string, string> = {
    ORGANIZATION: t('memory-info.visibility.organization', 'Organization'),
    PUBLIC: t('memory-info.visibility.public', 'Public'),
    GROUP: t('memory-info.visibility.group', 'Group'),
  };


  const card = 'rounded-xl border border-zinc-200 bg-white divide-y divide-zinc-200 overflow-hidden dark:border-zinc-800 dark:bg-zinc-900 dark:divide-zinc-800';
  const rowLabel = 'text-sm text-zinc-500';
  const rowValue = 'text-sm font-medium text-zinc-900 dark:text-white';
</script>

<svelte:head><title>{g.name} &middot; Info &middot; Hadron</title></svelte:head>

<div class="max-w-2xl space-y-6">
  <!-- Overview -->
  <section>
    <h2 class="mb-3 font-semibold text-zinc-900 dark:text-white">{t('memory-info.overview', 'Overview')}</h2>
    <div class={card}>
      <div class="flex items-center justify-between px-5 py-3">
        <span class={rowLabel}>{t('memory-info.owner', 'Owner')}</span>
        <span class={rowValue}>
          {#if isAgentSystem && g.agent}
            <a href={`/app/agents/${g.agent.id}`} class="text-indigo-600 hover:underline dark:text-indigo-300">{g.agent.name}</a>
          {:else if isOwnerOnly}
            {t('memory-info.only-you', 'Only you')}
          {:else if org}
            {org.name}
          {:else}
            —
          {/if}
        </span>
      </div>
      <div class="flex items-center justify-between px-5 py-3">
        <span class={rowLabel}>{t('memory-info.class', 'Class')}</span>
        <span class={rowValue}>{g.class ?? '—'}</span>
      </div>
      {#if g.class !== 'system' && g.class !== 'app'}
        <!-- visibility is null/meaningless for system + app classes -->
        <div class="flex items-center justify-between px-5 py-3">
          <span class={rowLabel}>{isOwnerOnly ? t('memory-info.access', 'Access') : t('memory-info.visibility', 'Visibility')}</span>
          <span class={rowValue}>
            {#if isOwnerOnly}{t('memory-info.only-you', 'Only you')}{:else}{(g.visibility && visibilityLabel[g.visibility]) ?? g.visibility ?? '—'}{/if}
          </span>
        </div>
      {/if}
      {#if g.shortDescription}
        <div class="px-5 py-3">
          <span class={rowLabel}>{t('memory-info.short-description', 'Short description')}</span>
          <p class="mt-1 text-sm text-zinc-900 dark:text-white">{g.shortDescription}</p>
        </div>
      {/if}
      {#if g.description}
        <div class="px-5 py-3">
          <span class={rowLabel}>{t('memory-info.description', 'Description')}</span>
          <p class="mt-1 whitespace-pre-wrap text-sm text-zinc-900 dark:text-white">{g.description}</p>
        </div>
      {/if}
      {#if g.tags?.length}
        <div class="flex items-center justify-between px-5 py-3">
          <span class={rowLabel}>{t('memory-info.tags', 'Tags')}</span>
          <span class={rowValue}>{g.tags.join(', ')}</span>
        </div>
      {/if}
      <div class="flex items-center justify-between px-5 py-3">
        <span class={rowLabel}>{t('memory-info.created', 'Created')}</span>
        <span class={rowValue}>{formatPortalDate(g.createdAt)}</span>
      </div>
      <div class="flex items-center justify-between px-5 py-3">
        <span class={rowLabel}>{t('memory-info.updated', 'Updated')}</span>
        <span class={rowValue}>{formatPortalDate(g.updatedAt)}</span>
      </div>
    </div>
  </section>

  <!-- Integration status -->
  <section>
    <h2 class="mb-3 font-semibold text-zinc-900 dark:text-white">{t('memory-info.integration', 'Integration')}</h2>
    <div class={card}>
      <div class="flex items-center justify-between px-5 py-3">
        <span class={rowLabel}>{t('memory-info.github', 'GitHub')}</span>
        <span class={rowValue}>{g.source ? t('memory-info.connected', 'Connected') : t('memory-info.not-connected', 'Not connected')}</span>
      </div>
      {#if g.source}
        <div class="flex items-center justify-between px-5 py-3">
          <span class={rowLabel}>{t('memory-info.repository', 'Repository')}</span>
          <span class="font-mono text-xs text-zinc-900 dark:text-white">{g.source}</span>
        </div>
        <div class="flex items-center justify-between px-5 py-3">
          <span class={rowLabel}>{t('memory-info.sync-status', 'Sync status')}</span>
          <span class={rowValue}>{g.syncStatus ?? '—'}{#if g.lastSyncedAt} &middot; {formatPortalDate(g.lastSyncedAt)}{/if}</span>
        </div>
        {#if g.syncStatus === 'ERROR'}
          <SyncErrorDetail syncError={g.syncError} />
        {/if}
      {/if}
    </div>
  </section>

  <!-- Stats -->
  <section>
    <h2 class="mb-3 font-semibold text-zinc-900 dark:text-white">{t('memory-info.stats', 'Stats')}</h2>
    <div class={card}>
      <div class="flex items-center justify-between px-5 py-3">
        <span class={rowLabel}>{t('memory-info.nodes', 'Nodes')}</span>
        <span class={rowValue}>{nodeCount.toLocaleString('en-US')}</span>
      </div>
    </div>
    <p class="mt-2 text-xs text-zinc-400">
      {t('memory-info.deferred-stats', 'Edge count, last use, and the agents/apps that include this memory are coming soon.')}
    </p>
  </section>
</div>
