<!--
  portal#1856 — the team-metrics view. The user wants to see how the team is doing and open the
  tasks and workers behind a number. Every figure is the server's `teamMetrics` answer as returned
  (hrn:node:hadronmemory.com:specs:cor:agt:150, Proposed): nothing is computed here. A null task report (a reader who may see the
  roster but not the App's tasks) says so and is never zero; APP_NOT_FOUND is the one refusal.
-->
<script lang="ts">
  import { t } from '$lib/i18n/t';
  import type { TeamMetricsView } from '$lib/team-metrics/types';
  import LiveRegion from '$lib/components/LiveRegion.svelte';
  import CountDrill from './CountDrill.svelte';
  import OwnerTable from './OwnerTable.svelte';
  import ProjectTable from './ProjectTable.svelte';

  let { view, appId, since = '', until = '' }: {
    view: TeamMetricsView; appId: string; since?: string; until?: string;
  } = $props();

  // UTC and a fixed locale on purpose: the server renders this and the browser re-renders it, and
  // the window bounds are UTC midnights, which a local zone would show as the previous day.
  const fmt = (iso: string) => `${new Date(iso).toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })} UTC`;
  const notVisible = t('team-metrics.not-visible', 'Not visible to you');
  const workerKinds = ['active', 'idle', 'overdue', 'inop'] as const;
  const workerLabel: Record<(typeof workerKinds)[number], string> = {
    active: t('team-metrics.workers.active', 'Active'),
    idle: t('team-metrics.workers.idle', 'Idle'),
    overdue: t('team-metrics.workers.overdue', 'Overdue'),
    inop: t('team-metrics.workers.inop', 'Not operating'),
  };
  const card = 'rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900';
</script>

{#if view.kind === 'hidden'}
  <LiveRegion><p class={card + ' text-sm text-zinc-700 dark:text-zinc-300'} data-testid="metrics-hidden">{t('team-metrics.hidden', 'App not found.')}</p></LiveRegion>
{:else if view.kind === 'failed'}
  <p class="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200" role="alert" data-testid="metrics-failed">{t('team-metrics.failed', 'Could not load the team metrics. Try again.')}</p>
{:else}
  <form method="get" class="flex flex-wrap items-end gap-3" data-testid="metrics-window-form">
    <div>
      <label for="metrics-since" class="block text-xs font-medium text-zinc-600 dark:text-zinc-400">{t('team-metrics.window.since', 'From')}</label>
      <input id="metrics-since" name="since" type="date" value={since} class="mt-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white" />
    </div>
    <div>
      <label for="metrics-until" class="block text-xs font-medium text-zinc-600 dark:text-zinc-400">{t('team-metrics.window.until', 'Until')}</label>
      <input id="metrics-until" name="until" type="date" value={until} class="mt-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white" />
    </div>
    <button type="submit" class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-indigo-500">{t('team-metrics.window.apply', 'Apply')}</button>
    <p class="basis-full text-xs text-zinc-500 dark:text-zinc-400">{t('team-metrics.window.help', 'The window only applies to Flow. It runs from the first day up to, not including, the last day, and is at most 31 days.')}</p>
  </form>
  {#if view.kind === 'invalid'}
    <p class="mt-3 text-sm text-red-700 dark:text-red-400" role="alert" data-testid="metrics-invalid">{t('team-metrics.invalid', 'That window was not accepted. Use two days at most 31 days apart, with From before Until.')}</p>
  {/if}

  {#if view.kind === 'ok' || (view.kind === 'invalid' && view.metrics)}
    {@const m = view.metrics!}
    <div class="mt-6 space-y-8">
      <section aria-labelledby="metrics-workers-h">
        <h2 id="metrics-workers-h" class="text-lg font-semibold">{t('team-metrics.workers.title', 'Workers')}</h2>
        <p class="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{t('team-metrics.as-of', 'As of {when}. A worker can be in more than one of these.', { when: fmt(m.asOf) })}</p>
        <dl class="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="metrics-workers">
          {#each workerKinds as k (k)}
            <div class={card}>
              <dt class="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{workerLabel[k]}</dt>
              <dd class="mt-1 text-2xl"><CountDrill count={m.workers[k]} kind="worker" {appId} label={t('team-metrics.label.workers', '{kind} workers', { kind: workerLabel[k] })} /></dd>
            </div>
          {/each}
        </dl>
      </section>

      <section aria-labelledby="metrics-started-h">
        <h2 id="metrics-started-h" class="text-lg font-semibold">{t('team-metrics.started.title', 'Started tasks')}</h2>
        <p class="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{t('team-metrics.started.help', 'Counts started tasks that name an issue or source, under their owner. A started task with no external work is not counted here.')}</p>
        {#if m.startedOwned === null}
          <p class={card + ' mt-3 text-sm text-zinc-600 dark:text-zinc-400'} data-testid="metrics-started-null">{notVisible}</p>
        {:else}
          <p class="mt-3 flex items-baseline gap-2 text-sm"><span>{t('team-metrics.started.total', 'Total')}</span> <CountDrill count={m.startedOwned.all} kind="task" {appId} label={t('team-metrics.label.started-all', 'started tasks')} /></p>
          {#if m.startedOwned.byOwner.length === 0}
            <p class={card + ' mt-3 text-sm text-zinc-600 dark:text-zinc-400'} data-testid="metrics-started-empty">{t('team-metrics.started.empty', 'No started tasks.')}</p>
          {:else}
            <div class="mt-3"><OwnerTable owners={m.startedOwned.byOwner} {appId} /></div>
          {/if}
          {#if m.startedOwned.ownersTruncated}
            <p class="mt-2 text-xs text-amber-800 dark:text-amber-300" data-testid="metrics-owners-truncated">{t('team-metrics.owners.truncated', 'More owners than the {n} listed.', { n: m.startedOwned.byOwner.length })}</p>
          {/if}
          {#if m.startedOwned.byOwner.some((g) => g.projectsTruncated)}
            <p class="mt-2 text-xs text-amber-800 dark:text-amber-300" data-testid="metrics-owner-projects-truncated">{t('team-metrics.owner-projects.truncated', 'Some owners have more projects than listed.')}</p>
          {/if}
        {/if}
      </section>

      <section aria-labelledby="metrics-projects-h">
        <h2 id="metrics-projects-h" class="text-lg font-semibold">{t('team-metrics.projects.title', 'Started projects')}</h2>
        {#if m.projects === null}
          <p class={card + ' mt-3 text-sm text-zinc-600 dark:text-zinc-400'} data-testid="metrics-projects-null">{notVisible}</p>
        {:else if m.projects.items.length === 0}
          <p class={card + ' mt-3 text-sm text-zinc-600 dark:text-zinc-400'} data-testid="metrics-projects-empty">{t('team-metrics.projects.empty', 'No started projects.')}</p>
        {:else}
          <div class="mt-3"><ProjectTable items={m.projects.items} {appId} /></div>
          {#if m.projects.truncated}
            <p class="mt-2 text-xs text-amber-800 dark:text-amber-300" data-testid="metrics-projects-truncated">{t('team-metrics.projects.truncated', 'More projects than the {n} listed.', { n: m.projects.items.length })}</p>
          {/if}
        {/if}
      </section>

      <section aria-labelledby="metrics-flow-h">
        <h2 id="metrics-flow-h" class="text-lg font-semibold">{t('team-metrics.flow.title', 'Flow')}</h2>
        <p class="mt-1 text-xs text-zinc-500 dark:text-zinc-400" data-testid="metrics-window">{t('team-metrics.flow.window', 'From {since} up to, not including, {until}. Counts every task, whether or not it names an issue.', { since: fmt(m.window.since), until: fmt(m.window.until) })}</p>
        {#if m.flow === null}
          <p class={card + ' mt-3 text-sm text-zinc-600 dark:text-zinc-400'} data-testid="metrics-flow-null">{notVisible}</p>
        {:else}
          <dl class="mt-3 grid grid-cols-2 gap-3 sm:max-w-md" data-testid="metrics-flow">
            <div class={card}>
              <dt class="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{t('team-metrics.flow.completed', 'Finished')}</dt>
              <dd class="mt-1 text-2xl"><CountDrill count={m.flow.completed} kind="task" {appId} label={t('team-metrics.label.finished', 'finished tasks')} /></dd>
            </div>
            <div class={card}>
              <dt class="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{t('team-metrics.flow.started', 'Started')}</dt>
              <dd class="mt-1 text-2xl"><CountDrill count={m.flow.started} kind="task" {appId} label={t('team-metrics.label.started', 'started tasks')} /></dd>
            </div>
          </dl>
        {/if}
      </section>
    </div>
  {/if}
{/if}
