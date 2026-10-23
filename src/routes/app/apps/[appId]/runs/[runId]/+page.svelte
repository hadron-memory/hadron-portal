<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { untrack } from 'svelte';
  import { superForm, type Infer, type SuperValidated } from 'sveltekit-superforms';
  import { zod4Client } from 'sveltekit-superforms/adapters';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import { scopedActionError, scopedActionSuccess } from '$lib/forms/scoped-message';
  import { submittedForm } from '$lib/forms/submitted-form';
  import { t } from '$lib/i18n/t';
  import {
    defaultRunRecordUrn,
    describeTrigger,
    failureCode,
    failureMessage,
    fmtRunTime,
    fmtHopDuration,
    fmtHopTokens,
    isCancellable,
    parseHops,
    type RunTrail,
    runDuration,
    statusChipClass,
    visibleEnvelope,
  } from '$lib/flow/runs';
  import type { PageData, ActionData } from './$types';
  import { cancelAppRunSchema } from './schema';

  type CancelAppRunForm = Infer<typeof cancelAppRunSchema, 'zod4'>;
  type CancelAppRunSuperform = SuperValidated<CancelAppRunForm, App.Superforms.Message, CancelAppRunForm>;

  let { data, form }: { data: PageData; form: ActionData } = $props();

  const run = $derived(data.run);
  // #648: canonical org-optional (see the runs list page).
  const basePath = $derived(`/app/apps/${data.app.id}`);
  const appsHref = $derived(
    data.app.organizationId ? `/app/orgs/${data.app.organizationId}/apps` : '/app/apps',
  );
  const live = $derived(isCancellable(run.status));
  const envelope = $derived(visibleEnvelope(data.envelope));
  const eventDataShown = $derived(visibleEnvelope(run.eventData));
  // #482: the trail belongs to the run it was read for. A trail stamped for any
  // other run (a poll answered after navigation) is never shown on this one.
  const trail = $derived<RunTrail>(
    data.trail.runId === run.id && data.trail.supported ? parseHops(data.trail.raw) : { state: 'unavailable' },
  );
  // The step in flight / the step that failed has NO hops element (only completed
  // hops are recorded), so it is shown apart from the rows, never as one.
  const stoppedLabel = $derived(
    run.status === 'FAILED' ? t('run.timeline.failed-at', 'Failed at')
      : run.status === 'TIMED_OUT' ? t('run.timeline.timed-out-at', 'Timed out at')
      : null,
  );
  const recordUrn = $derived(run.status === 'COMPLETED' ? defaultRunRecordUrn(run) : null);
  const initialCancelForm = untrack(() => submittedForm<CancelAppRunForm>(form, 'cancelRun') as CancelAppRunSuperform | null ?? data.cancelForm);
  const {
    form: cancelForm,
    errors: cancelErrors,
    message: cancelMessage,
    submitting: cancelSubmitting,
    enhance: cancelEnhance,
  } = superForm<CancelAppRunForm, App.Superforms.Message, CancelAppRunForm>(initialCancelForm, {
    validators: zod4Client(cancelAppRunSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
  });
  const cancelActionError = $derived(scopedActionError<CancelAppRunForm>(form, 'cancelRun', $cancelMessage, $cancelErrors));
  const cancelActionSuccess = $derived(scopedActionSuccess<CancelAppRunForm>(form, 'cancelRun', $cancelMessage));

  let confirmCancel = $state(false);

  // Live view: while the run is PENDING/RUNNING, poll the loader so status,
  // curNodeUrn, and budgets track the walker. Cleared automatically when the
  // run reaches a terminal state (the $effect re-runs on `live` flips).
  $effect(() => {
    if (!live) return;
    const timer = setInterval(() => invalidateAll(), 3000);
    return () => clearInterval(timer);
  });

  const rowLabel = 'text-xs font-semibold uppercase tracking-wide text-zinc-500';
  const rowValue = 'text-sm text-zinc-800 dark:text-zinc-200';
</script>

<svelte:head><title>Run {run.id.slice(0, 8)} · {data.app.name} · Hadron</title></svelte:head>

<div class="max-w-3xl space-y-4">
  <Breadcrumb items={[
    { label: 'Apps', href: appsHref },
    { label: data.app.name, href: basePath },
    { label: 'Runs', href: `${basePath}/runs` },
    { label: run.id.slice(0, 8) },
  ]} />

  <div class="flex flex-wrap items-start justify-between gap-3">
    <div>
      <h1 class="flex items-center gap-3 text-xl font-bold text-zinc-900 dark:text-white">
        {t('run.title', 'Run')}
        <span class="rounded-full px-2.5 py-0.5 text-sm font-medium {statusChipClass(run.status)}">
          {run.status}{#if live}<span class="ml-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current align-middle"></span>{/if}
        </span>
      </h1>
      <p class="mt-1 font-mono text-xs text-zinc-500">{run.id}</p>
    </div>
    {#if live}
      {#if !confirmCancel}
        <button
          type="button"
          onclick={() => (confirmCancel = true)}
          class="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
        >{t('run.cancel', 'Stop this run')}</button>
      {:else}
        <form method="POST" action="?/cancel" use:cancelEnhance class="flex items-center gap-2" novalidate>
          <input type="hidden" name="_kind" value={$cancelForm._kind} />
          <span class="text-sm text-red-600 dark:text-red-400">{t('run.cancel.confirm', 'Stop at the next action?')}</span>
          <button type="submit" disabled={$cancelSubmitting} class="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50">
            {$cancelSubmitting ? t('run.cancel.stopping', 'Stopping...') : t('run.cancel.yes', 'Yes, stop it')}
          </button>
          <button type="button" onclick={() => (confirmCancel = false)} class="text-sm text-zinc-500 hover:text-zinc-300">
            {t('run.cancel.keep', 'Keep running')}
          </button>
        </form>
      {/if}
    {/if}
  </div>

  {#if cancelActionError}
    <div role="alert" class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{cancelActionError}</div>
  {:else if cancelActionSuccess}
    <div role="status" class="rounded-lg border border-green-800 bg-green-950 px-4 py-3 text-sm text-green-300">{cancelActionSuccess}</div>
  {/if}

  <!-- Provenance: who/what/why -->
  <section class="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
    <div class="grid gap-4 sm:grid-cols-2">
      <div>
        <p class={rowLabel}>{t('run.trigger', 'Trigger')}</p>
        <p class={rowValue}>{describeTrigger(run)}</p>
      </div>
      <div>
        <p class={rowLabel}>{t('run.attempts', 'Attempts')}</p>
        <p class={rowValue}>{run.attempts}</p>
      </div>
      <div class="sm:col-span-2">
        <p class={rowLabel}>{t('run.entry', 'Entry node')}</p>
        <div class="mt-0.5"><Urn value={run.entryNodeUrn} type="node" size={11} /></div>
      </div>
      {#if run.curNodeUrn && live}
        <div class="sm:col-span-2">
          <p class={rowLabel}>{t('run.position', 'Currently at')}</p>
          <div class="mt-0.5"><Urn value={run.curNodeUrn} type="node" size={11} /></div>
        </div>
      {/if}
      <div>
        <p class={rowLabel}>{t('run.created', 'Created')}</p>
        <p class={rowValue}>{fmtRunTime(run.createdAt)}</p>
      </div>
      <div>
        <p class={rowLabel}>{t('run.started', 'Started / finished')}</p>
        <p class={rowValue}>{fmtRunTime(run.startedAt)} → {fmtRunTime(run.finishedAt)} ({runDuration(run)})</p>
      </div>
      <div>
        <p class={rowLabel}>{t('run.budget.tokens', 'Token budget left')}</p>
        <p class={rowValue}>{run.budgetTokens ?? '—'}</p>
      </div>
      <div>
        <p class={rowLabel}>{t('run.budget.actions', 'Action budget left')}</p>
        <p class={rowValue}>{run.budgetActions ?? '—'}</p>
      </div>
      {#if run.createdBy}
        <div>
          <p class={rowLabel}>{t('run.created-by', 'Created by')}</p>
          <p class="{rowValue} font-mono text-xs">{run.createdBy}</p>
        </div>
      {/if}
      {#if recordUrn}
        <div class="sm:col-span-2">
          <p class={rowLabel}>{t('run.record', 'Run record')}</p>
          <div class="mt-0.5"><Urn value={recordUrn} type="node" size={11} /></div>
          <p class="mt-1 text-xs text-zinc-400">
            {t('run.record.hint', 'Default location — written beside the entry node unless the flow’s last node has its own output target.')}
          </p>
        </div>
      {/if}
    </div>
  </section>

  <!-- Failure -->
  {#if run.failure}
    <section class="rounded-xl border border-red-200 bg-red-50 p-5 dark:border-red-900 dark:bg-red-950/40">
      <h2 class="text-sm font-semibold text-red-700 dark:text-red-300">
        {failureCode(run) ?? t('run.failure', 'Failure')}
      </h2>
      {#if failureMessage(run)}
        <p class="mt-1 text-sm text-red-700/90 dark:text-red-300/90">{failureMessage(run)}</p>
      {/if}
      <pre class="mt-3 overflow-x-auto rounded-lg bg-white/60 p-3 font-mono text-xs text-red-900 dark:bg-black/30 dark:text-red-200">{JSON.stringify(run.failure, null, 2)}</pre>
    </section>
  {/if}

  <!-- Step timeline: the completed hops (#482) -->
  <section class="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900" aria-labelledby="run-timeline-heading">
    <h2 id="run-timeline-heading" class="text-sm font-semibold text-zinc-900 dark:text-white">{t('run.timeline', 'Step timeline')}</h2>
    <p class="mt-1 text-xs text-zinc-400">
      {t('run.timeline.hint', 'Steps the run has completed, in order. The step in progress, or the one that failed, is not listed until it completes.')}
    </p>
    {#if trail.state === 'unavailable'}
      <p class="mt-3 text-sm text-zinc-500 dark:text-zinc-400">{t('run.timeline.unavailable', 'Step trail unavailable for this run.')}</p>
    {:else if trail.hops.length === 0}
      <p class="mt-3 text-sm text-zinc-500 dark:text-zinc-400">{t('run.timeline.empty', 'No completed steps recorded.')}</p>
    {:else}
      <ol class="mt-3 space-y-2">
        {#each trail.hops as hop, i (i)}
          <li data-testid="hop-row" class="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span class="text-xs font-semibold text-zinc-500">{i + 1}</span>
              <Urn value={hop.node} type="node" size={11} label={t('run.timeline.step', 'step')} />
            </div>
            <dl class="mt-2 grid gap-2 text-xs sm:grid-cols-3">
              <div>
                <dt class={rowLabel}>{t('run.timeline.duration', 'Duration')}</dt>
                <dd class={rowValue}>{fmtHopDuration(hop.startedAt, hop.finishedAt)}</dd>
              </div>
              <div>
                <dt class={rowLabel}>{t('run.timeline.tokens', 'Tokens')}</dt>
                <dd class={rowValue}>{fmtHopTokens(hop.tokensSpent)}</dd>
              </div>
              <div>
                <dt class={rowLabel}>{t('run.timeline.edge-out', 'Edge taken next')}</dt>
                <dd class={rowValue}>
                  {#if hop.edgeOut}<Urn value={hop.edgeOut} type="edge" size={11} copyUrl={false} label={t('run.timeline.edge', 'edge')} />{:else}—{/if}
                </dd>
              </div>
            </dl>
          </li>
        {/each}
      </ol>
    {/if}
    {#if run.curNodeUrn && (live || stoppedLabel)}
      <div data-testid="timeline-current" class="mt-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
        <p class={rowLabel}>{live ? t('run.timeline.in-progress-at', 'In progress at') : stoppedLabel}</p>
        <div class="mt-0.5"><Urn value={run.curNodeUrn} type="node" size={11} /></div>
      </div>
    {/if}
  </section>

  <!-- Envelope: what the flow extracted -->
  <section class="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
    <h2 class="text-sm font-semibold text-zinc-900 dark:text-white">{t('run.envelope', 'Extracted fields')}</h2>
    <p class="mt-1 text-xs text-zinc-400">
      {t('run.envelope.hint', 'Fields the flow’s nodes extracted as it ran — the values routing conditions branched on.')}
    </p>
    {#if !data.envelopeSupported}
      <p class="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
        {t('run.envelope.unsupported', 'This server doesn’t expose the run envelope yet.')}
      </p>
    {:else if envelope}
      <pre class="mt-3 overflow-x-auto rounded-lg border border-zinc-200 bg-zinc-50 p-3 font-mono text-xs text-zinc-800 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">{JSON.stringify(envelope, null, 2)}</pre>
    {:else}
      <p class="mt-3 text-sm text-zinc-500 dark:text-zinc-400">{t('run.envelope.empty', 'Nothing extracted (yet).')}</p>
    {/if}
  </section>

  <!-- Trigger payload -->
  {#if eventDataShown}
    <section class="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 class="text-sm font-semibold text-zinc-900 dark:text-white">{t('run.event-data', 'Trigger payload')}</h2>
      <p class="mt-1 text-xs text-zinc-400">
        {t('run.event-data.hint', 'The immutable payload the trigger delivered — extracted fields win on name collisions.')}
      </p>
      <pre class="mt-3 overflow-x-auto rounded-lg border border-zinc-200 bg-zinc-50 p-3 font-mono text-xs text-zinc-800 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">{JSON.stringify(eventDataShown, null, 2)}</pre>
    </section>
  {/if}
</div>
