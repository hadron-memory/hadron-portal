<script lang="ts">
  import { untrack } from 'svelte';
  import { superForm, type Infer, type SuperValidated } from 'sveltekit-superforms';
  import { zod4Client } from 'sveltekit-superforms/adapters';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import { scopedActionError } from '$lib/forms/scoped-message';
  import { submittedForm } from '$lib/forms/submitted-form';
  import { t } from '$lib/i18n/t';
  import {
    RUN_STATUSES,
    describeTrigger,
    failureCode,
    fmtRunTime,
    runDuration,
    statusChipClass,
  } from '$lib/flow/runs';
  import type { PageData, ActionData } from './$types';
  import { runAppFlowSchema } from './schema';

  type RunAppFlowForm = Infer<typeof runAppFlowSchema, 'zod4'>;
  type RunAppFlowSuperform = SuperValidated<RunAppFlowForm, App.Superforms.Message, RunAppFlowForm>;

  let { data, form }: { data: PageData; form: ActionData } = $props();

  // #648: canonical org-optional. The app's own page + list live at org-
  // independent /app/apps/[appId]; the "Apps" crumb points at the org grid for an
  // org app, else the personal "My apps" list.
  const basePath = $derived(`/app/apps/${data.app.id}`);
  const appsHref = $derived(
    data.app.organizationId ? `/app/orgs/${data.app.organizationId}/apps` : '/app/apps',
  );
  const totalPages = $derived(Math.max(1, Math.ceil(data.total / data.pageSize)));
  const initialRunForm = untrack(() => submittedForm<RunAppFlowForm>(form, 'runFlow') as RunAppFlowSuperform | null ?? data.runForm);
  const {
    form: runFormData,
    errors: runErrors,
    message: runMessage,
    submitting: runSubmitting,
    enhance: runEnhance,
  } = superForm<RunAppFlowForm, App.Superforms.Message, RunAppFlowForm>(initialRunForm, {
    validators: zod4Client(runAppFlowSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
  });
  const runActionError = $derived(scopedActionError<RunAppFlowForm>(form, 'runFlow', $runMessage, $runErrors, ['entryUrn', '_kind']));

  function pageHref(page: number, status: string | null): string {
    const qs = new URLSearchParams();
    if (page > 1) qs.set('page', String(page));
    if (status) qs.set('status', status);
    const s = qs.toString();
    return `${basePath}/runs${s ? `?${s}` : ''}`;
  }

  /** Entry-node display: the loc, with the memory prefix as a title. */
  function entryLabel(urn: string): string {
    const sep = urn.lastIndexOf('::');
    return sep >= 0 ? urn.slice(sep + 2) : urn;
  }

  function prepareRun(entryUrn: string) {
    runFormData.update((current) => ({ ...current, entryUrn }), { taint: false });
  }
</script>

<svelte:head><title>Runs · {data.app.name} · Hadron</title></svelte:head>

<div class="space-y-4">
  <Breadcrumb items={[
    { label: 'Apps', href: appsHref },
    { label: data.app.name, href: basePath },
    { label: 'Runs' },
  ]} />

  <div class="flex items-start justify-between gap-3">
    <div>
      <h1 class="text-xl font-bold text-zinc-900 dark:text-white">
        <span class="font-normal text-zinc-400">{t('runs.title.prefix', 'Runs:')}</span> {data.app.name}
      </h1>
      <p class="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        {t('runs.subtitle', 'Every headless run of this app — what ran, why, what it cost. Open a run to watch it live or stop it.')}
      </p>
    </div>
  </div>

  <!-- Flows this app can start (#483) — derived: runnable entry nodes with
       routing edges. The Run button mints a MANUAL run; payloads live on the
       node page's Test-flow panel. -->
  {#if data.flows.length > 0}
    <section class="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 class="text-sm font-semibold text-zinc-900 dark:text-white">{t('flows.title', 'Flows')}</h2>
      <p class="mt-1 text-xs text-zinc-400">
        {t('flows.explainer', 'Runnable entry nodes with routing edges in this app’s memories. Run one here, or open the node to run it with a test payload.')}
      </p>
      {#if runActionError}
        <div role="alert" class="mt-3 rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{runActionError}</div>
      {/if}
      <ul class="mt-3 divide-y divide-zinc-100 dark:divide-zinc-800">
        {#each data.flows as flow (flow.entry.id)}
          <li class="flex flex-wrap items-center gap-x-4 gap-y-2 py-2.5">
            <div class="min-w-0 flex-1">
              <a
                href="/app/memories/{flow.entry.memoryId}/nodes/{flow.entry.id}"
                class="font-medium text-indigo-600 hover:underline dark:text-indigo-300"
              >{flow.entry.name}</a>
              <div class="mt-0.5"><Urn value={flow.entry.urn} type="node" size={10} /></div>
            </div>
            <span class="text-xs text-zinc-500 dark:text-zinc-400">
              {flow.stepCount} {t('flows.steps', 'steps')}{#if flow.branchCount > 1} · {flow.branchCount} {t('flows.branches', 'branches')}{/if}
            </span>
            <!-- Click updates before Superforms client validation; submit covers keyboard/requestSubmit paths. -->
            <form method="POST" action="?/run" use:runEnhance onsubmit={() => prepareRun(flow.entry.urn)} novalidate>
              <input type="hidden" name="_kind" value={$runFormData._kind} />
              <input type="hidden" name="entryUrn" value={flow.entry.urn} />
              <button
                type="submit"
                disabled={$runSubmitting}
                onclick={() => prepareRun(flow.entry.urn)}
                class="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
              >▶ {t('flows.run', 'Run')}</button>
            </form>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <!-- Status filter -->
  <div class="flex flex-wrap items-center gap-1.5">
    <a
      href={pageHref(1, null)}
      class="rounded-full px-2.5 py-1 text-xs font-medium {data.status === null
        ? 'bg-indigo-600 text-white'
        : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'}"
    >{t('runs.filter.all', 'All')}</a>
    {#each RUN_STATUSES as status (status)}
      <a
        href={pageHref(1, status)}
        class="rounded-full px-2.5 py-1 text-xs font-medium {data.status === status
          ? 'bg-indigo-600 text-white'
          : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'}"
      >{status}</a>
    {/each}
  </div>

  {#if data.runs.length === 0}
    <div class="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-8 text-center dark:border-zinc-700 dark:bg-zinc-900/50">
      <p class="text-sm font-medium text-zinc-600 dark:text-zinc-300">
        {data.status
          ? t('runs.empty.filtered', 'No runs with this status yet.')
          : t('runs.empty.title', 'No runs yet.')}
      </p>
      {#if !data.status}
        <p class="mx-auto mt-2 max-w-lg text-xs text-zinc-500 dark:text-zinc-400">
          {#if data.flows.length > 0}
            {t(
              'runs.empty.explainer.flows',
              'Runs start from a trigger: a schedule (run every morning), a webhook (run when an outside system calls), or manually — hit Run on a flow above to mint one.',
            )}
          {:else}
            {t(
              'runs.empty.explainer',
              'Runs start from a trigger: a schedule (run every morning), a webhook (run when an outside system calls), or manually — the “Test flow” button on any runnable node mints one.',
            )}
          {/if}
        </p>
      {/if}
    </div>
  {:else}
    <div class="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
      <table class="w-full min-w-[720px] border-collapse bg-white text-sm dark:bg-zinc-900">
        <thead>
          <tr class="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
            <th class="px-3 py-2 font-medium">{t('runs.col.status', 'Status')}</th>
            <th class="px-3 py-2 font-medium">{t('runs.col.trigger', 'Trigger')}</th>
            <th class="px-3 py-2 font-medium">{t('runs.col.entry', 'Entry node')}</th>
            <th class="px-3 py-2 font-medium">{t('runs.col.started', 'Started')}</th>
            <th class="px-3 py-2 font-medium">{t('runs.col.duration', 'Duration')}</th>
            <th class="px-3 py-2 font-medium">{t('runs.col.failure', 'Failure')}</th>
            <th class="px-3 py-2"><span class="sr-only">{t('runs.col.open', 'Open')}</span></th>
          </tr>
        </thead>
        <tbody>
          {#each data.runs as run (run.id)}
            <tr class="border-b border-zinc-100 last:border-0 hover:bg-zinc-50 dark:border-zinc-800/60 dark:hover:bg-zinc-800/40">
              <td class="px-3 py-2">
                <span class="rounded-full px-2 py-0.5 text-xs font-medium {statusChipClass(run.status)}">{run.status}</span>
              </td>
              <td class="px-3 py-2 text-zinc-700 dark:text-zinc-300">{describeTrigger(run)}</td>
              <td class="px-3 py-2 font-mono text-xs text-zinc-600 dark:text-zinc-300" title={run.entryNodeUrn}>
                {entryLabel(run.entryNodeUrn)}
              </td>
              <td class="px-3 py-2 whitespace-nowrap text-zinc-600 dark:text-zinc-300">{fmtRunTime(run.startedAt ?? run.createdAt)}</td>
              <td class="px-3 py-2 whitespace-nowrap text-zinc-600 dark:text-zinc-300">{runDuration(run)}</td>
              <td class="px-3 py-2 font-mono text-xs text-red-600 dark:text-red-400">{failureCode(run) ?? ''}</td>
              <td class="px-3 py-2 text-right">
                <a
                  href="{basePath}/runs/{run.id}"
                  class="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-300"
                >{t('runs.open', 'Open')}</a>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <!-- Pager -->
    {#if totalPages > 1}
      <div class="flex items-center justify-between text-sm text-zinc-500">
        <span>{t('runs.pager.total', 'Total:')} {data.total}</span>
        <div class="flex items-center gap-2">
          {#if data.page > 1}
            <a href={pageHref(data.page - 1, data.status)} class="rounded-md border border-zinc-300 px-3 py-1 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">
              {t('runs.pager.prev', 'Previous')}
            </a>
          {/if}
          <span>{data.page} / {totalPages}</span>
          {#if data.page < totalPages}
            <a href={pageHref(data.page + 1, data.status)} class="rounded-md border border-zinc-300 px-3 py-1 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">
              {t('runs.pager.next', 'Next')}
            </a>
          {/if}
        </div>
      </div>
    {/if}
  {/if}
</div>
