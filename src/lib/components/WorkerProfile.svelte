<script lang="ts">
  import type { Worker } from '$lib/types';
  import { t } from '$lib/i18n/t';
  import { page } from '$app/stores';
  import { formatPortalDateTime } from '$lib/format-portal-date';
  import Breadcrumb from './Breadcrumb.svelte';
  import Urn from './Urn.svelte';
  import WorkerBadge from './WorkerBadge.svelte';
  let { worker }: { worker: Worker } = $props();

  // The link is the server's own `portalUrl`, never one we build, and only when
  // it points back at this portal: a Profile reader gets no outbound link from
  // a value another party supplied. Anything else stays plain text.
  const portalHref = $derived.by(() => {
    if (!worker.portalUrl) return null;
    try {
      const url = new URL(worker.portalUrl);
      return url.origin === $page.url.origin ? url.href : null;
    } catch {
      return null;
    }
  });
</script>
<div class="mx-auto max-w-3xl space-y-6 py-6">
  <!-- The Dashboard is the one place every reader of a Profile can reach: this
       tier does not assume they may open the worker's App or Agent. -->
  <Breadcrumb items={[
    { label: t('worker.breadcrumb.dashboard', 'Dashboard'), href: '/app/dashboard' },
    { label: worker.name },
  ]} />
  <header>
    <div class="flex flex-wrap items-center gap-3">
      <h1 class="text-2xl font-bold text-zinc-900 dark:text-white">{worker.name}</h1>
      <WorkerBadge retired={!!worker.retiredAt} />
    </div>
    {#if worker.urn}<div class="mt-1"><Urn value={worker.urn} type="worker" /></div>{/if}
  </header>
  <dl class="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-zinc-200 bg-zinc-200 sm:grid-cols-2 dark:border-zinc-800 dark:bg-zinc-800">
    {#each [
      [t('worker.field.role', 'Role'), worker.role],
      [t('worker.field.app', 'Team App'), worker.appName],
      [t('worker.profile.owner', 'Owner'), worker.ownerName],
      [t('worker.profile.id', 'Worker id'), worker.id],
      [t('worker.profile.slug', 'Slug'), worker.slug],
      [t('worker.profile.app-id', 'App id'), worker.appId],
      [t('worker.profile.agent-id', 'Agent id'), worker.agentId],
      [t('worker.field.cast', 'Cast'), formatPortalDateTime(worker.createdAt)],
      ...(worker.retiredAt ? [[t('worker.field.retired', 'Retired'), formatPortalDateTime(worker.retiredAt)]] : []),
    ] as [label, value]}
      <div class="min-w-0 bg-white p-4 dark:bg-zinc-950">
        <dt class="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</dt>
        <dd class="mt-1 break-words text-sm text-zinc-900 dark:text-white">{value ?? '—'}</dd>
      </div>
    {/each}
    <div class="min-w-0 bg-white p-4 dark:bg-zinc-950">
      <dt class="text-xs font-medium uppercase tracking-wide text-zinc-500">{t('worker.profile.url', 'Profile URL')}</dt>
      <dd class="mt-1 break-all text-sm text-zinc-900 dark:text-white">
        {#if portalHref}<a href={portalHref} class="text-indigo-600 hover:underline dark:text-indigo-300">{worker.portalUrl}</a>
        {:else}{worker.portalUrl ?? '—'}{/if}
      </dd>
    </div>
    {#if worker.appUrn}
      <div class="min-w-0 bg-white p-4 dark:bg-zinc-950">
        <dt class="text-xs font-medium uppercase tracking-wide text-zinc-500">{t('worker.profile.app-urn', 'App URN')}</dt>
        <dd class="mt-1"><Urn value={worker.appUrn} type="app" /></dd>
      </div>
    {/if}
    {#if worker.agent}
      <div class="min-w-0 bg-white p-4 dark:bg-zinc-950">
        <dt class="text-xs font-medium uppercase tracking-wide text-zinc-500">{t('worker.field.agent', 'Backed by')}</dt>
        <dd class="mt-1 text-sm"><a href="/app/agents/{encodeURIComponent(worker.agent.id)}" class="text-indigo-600 hover:underline dark:text-indigo-300">{worker.agent.name}</a>
          {#if worker.agent.urn}<div class="mt-1"><Urn value={worker.agent.urn} type="agent" /></div>{/if}
        </dd>
      </div>
    {/if}
  </dl>
</div>
