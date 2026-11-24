<!--
  portal#1099 — the Worker page's Wake-ups tab (design §4), READ-ONLY (S7a).
  The answer first: one sentence saying why this worker is or isn't woken
  (§4.1, `wakeStatus`), then its settings and subscriptions as they are.
  Mentions, Pause and Subscribe controls are S7b and not rendered; the line
  under the settings says who can change them instead, and (portal#1496) the
  hadron CLI commands that change them.
-->
<script lang="ts">
  import DataTable from '$lib/components/table/DataTable.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import TickersNotParticipant from '$lib/components/tickers/TickersNotParticipant.svelte';
  import ApplyAgentTickers from '$lib/components/tickers/ApplyAgentTickers.svelte';
  import CliCommand from '$lib/components/tickers/CliCommand.svelte';
  import { cliRef, wakeCommands } from '$lib/cli-command';
  import type { ApplyResult } from '$lib/tickers/apply';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import { makeGlobalFilterFn } from '$lib/table/global-filter';
  import type { PortalColumnDef } from '$lib/table/features';
  import { fmtRunTime, parseApiDate } from '$lib/flow/runs';
  import { cadenceText, quietHoursSummary, subscriptionSearchText, tickerStateLabel } from '$lib/tickers/format';
  import { wakeStatus } from '$lib/tickers/wake';
  import type { AppTickerSettings, TickerRead, WakeSubscription, WorkerWakeSettings } from '$lib/tickers/types';
  import { t } from '$lib/i18n/t';

  let {
    wake,
    appSettings,
    worker,
    appId,
    loadedAt,
    canManage = false,
    applyKey,
    applyAction = '?tab=wake&/applyTickerTemplates',
    applyResult = null,
    viewerId = null,
    errorPageWorker,
  }: {
    wake: TickerRead<WorkerWakeSettings>;
    appSettings: TickerRead<AppTickerSettings> | null;
    worker: { retiredAt: string | null; id?: string; urn?: string | null; app?: { organizationId?: string | null } | null };
    appId: string | null;
    loadedAt: string;
    /** portal#1462: may the viewer manage the worker's App (null = unknown; the server decides). */
    canManage?: boolean | null;
    /** The route's identity for this worker: what the apply action keys its result with. */
    applyKey: string;
    applyAction?: string;
    applyResult?: ApplyResult | null;
    viewerId?: string | null;
    errorPageWorker: () => string | null;
  } = $props();

  const now = $derived(Date.parse(loadedAt));
  const status = $derived(wake.kind === 'ok' ? wakeStatus(wake.value, worker, now) : null);
  const cliTarget = $derived(cliRef(worker));
  const cli = $derived(cliTarget ? wakeCommands(cliTarget) : null);
  const minCadence = $derived(appSettings?.kind === 'ok' ? appSettings.value.minCadenceSeconds : null);

  interface Row {
    sub: WakeSubscription;
    tickerText: string;
    cadence: number;
    quiet: string;
    byText: string;
    sinceMs: number;
  }
  const rows = $derived<Row[]>(
    wake.kind === 'ok'
      ? wake.value.subscriptions.map((sub) => ({
          sub,
          // What the cell shows: name, URN, and "Disabled" only when it is (Anne's P3).
          tickerText: [sub.ticker.name, sub.ticker.urn ?? '', sub.ticker.enabled ? '' : tickerStateLabel(false)].filter(Boolean).join(' '),
          cadence: sub.ticker.cadenceSeconds,
          quiet: quietHoursSummary(sub.ticker.quietHours),
          byText: subscriptionSearchText({ name: sub.createdBy?.name, viaGrant: sub.viaGrant }),
          sinceMs: parseApiDate(sub.createdAt)?.getTime() ?? 0,
        }))
      : [],
  );
  let globalFilter = $state('');
  const columns: PortalColumnDef<Row>[] = [
    { id: 'ticker', accessorFn: (r) => r.tickerText, header: t('worker.wake.col.ticker', 'Ticker'), enableHiding: false, size: 240 },
    { id: 'cadence', accessorFn: (r) => r.cadence, header: t('worker.wake.col.every', 'Every'), size: 100 },
    { id: 'quiet', accessorFn: (r) => r.quiet, header: t('worker.wake.col.quiet', 'Quiet hours'), size: 240 },
    { id: 'by', accessorFn: (r) => r.byText, header: t('worker.wake.col.by', 'Subscribed by'), size: 200 },
    { id: 'since', accessorFn: (r) => r.sinceMs, header: t('worker.wake.col.since', 'Since'), size: 170 },
  ];
  const fmtCadence = (v: unknown) => (typeof v === 'number' ? cadenceText(v) : '');
  const fmtMs = (v: unknown) => (typeof v === 'number' && v > 0 ? fmtRunTime(String(v)) : '');
  const table = createSvelteTable<Row>({
    get data() { return rows; },
    columns,
    enableMultiSort: false,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    state: { get globalFilter() { return globalFilter; } },
    onGlobalFilterChange: (u) => { globalFilter = typeof u === 'function' ? u(globalFilter) : u; },
    globalFilterFn: makeGlobalFilterFn<Row>({ cadence: fmtCadence, since: fmtMs }),
    initialState: { pagination: { pageIndex: 0, pageSize: 20 }, sorting: [{ id: 'cadence', desc: false }] },
  });
</script>

<section class="space-y-4" data-testid="wake-panel">
  <!-- portal#1462: independent of the reads below, so a failed read never hides it. -->
  {#key applyKey}
    <ApplyAgentTickers canManage={canManage} action={applyAction} workerKey={applyKey} result={applyResult} floorSeconds={minCadence} {viewerId} workerIdentity={worker.id ? { id: worker.id, urn: worker.urn ?? null, appId, orgId: worker.app?.organizationId ?? null } : null} {errorPageWorker} />
  {/key}
  {#if wake.kind === 'not-participant'}
    <TickersNotParticipant what="wake" />
  {:else if wake.kind === 'failed'}
    <div role="alert" class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
      {t('worker.wake.failed', 'Couldn’t load this worker’s tickers.')}
      <a href="?tab=wake" data-sveltekit-reload class="ml-2 font-medium underline">{t('worker.wake.retry', 'Try again')}</a>
    </div>
  {:else if status}
    {@const s = wake.value}
    <!-- §4.1: the answer comes first, at every width. -->
    <div class="rounded-xl border border-zinc-300 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900" data-testid="wake-status" data-kind={status.kind}>
      <p class="text-sm text-zinc-900 dark:text-white">
        {#if status.lead}<strong>{status.lead}</strong>{/if}
        {status.text}
      </p>
      {#if status.kind === 'unknown'}
        <!-- Never another row's sentence: the raw fields, so a reader can see what didn't fit. -->
        <dl class="mt-2 grid grid-cols-[auto_1fr] gap-x-3 font-mono text-xs text-zinc-600 dark:text-zinc-400" data-testid="wake-raw">
          <dt>mentions</dt><dd>{s.mentions}</dd>
          <dt>pausedUntil</dt><dd>{s.pausedUntil ?? 'null'}</dd>
          <dt>dormant</dt><dd>{String(s.dormant)}</dd>
          <dt>effectiveCadenceSeconds</dt><dd>{s.effectiveCadenceSeconds ?? 'null'}</dd>
          <dt>subscriptions</dt><dd>{s.subscriptions.length}</dd>
        </dl>
      {/if}
      {#if minCadence != null}
        <p class="mt-2 text-xs text-zinc-500 dark:text-zinc-400">{t('worker.wake.floor', 'No worker is woken more often than every {every} in this App.', { every: cadenceText(minCadence) })}</p>
      {/if}
      <p class="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{t('worker.wake.router', 'A router delivers the wakes. This page shows when the worker is due, not whether a wake was delivered.')}</p>
    </div>

    <dl class="grid gap-3 rounded-xl border border-zinc-200 bg-white p-4 text-sm sm:grid-cols-3 dark:border-zinc-800 dark:bg-zinc-900" data-testid="wake-settings">
      <div class="min-w-0">
        <dt class="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{t('worker.wake.mentions', 'Mentions')}</dt>
        <dd class="text-zinc-900 dark:text-white">
          {s.mentions === 'IMMEDIATE'
            ? t('worker.wake.mentions.immediate', 'Wake at once')
            : s.mentions === 'OFF'
              ? t('worker.wake.mentions.off', 'Off')
              : s.mentions}
        </dd>
      </div>
      <div class="min-w-0">
        <dt class="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{t('worker.wake.pause', 'Pause')}</dt>
        <dd class="text-zinc-900 dark:text-white">
          {#if s.pausedUntil && Date.parse(s.pausedUntil) > now}
            {t('worker.wake.paused-until', 'Paused until {time}', { time: fmtRunTime(s.pausedUntil) })}
          {:else}
            {t('worker.wake.not-paused', 'Not paused')}
          {/if}
        </dd>
      </div>
      <div class="min-w-0">
        <dt class="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{t('worker.wake.effective', 'Fastest ticker')}</dt>
        <dd class="text-zinc-900 dark:text-white">
          {s.effectiveCadenceSeconds != null
            ? t('worker.wake.effective.every', 'Every {every}', { every: cadenceText(s.effectiveCadenceSeconds) })
            : t('tickers.cadence.none', 'None')}
        </dd>
      </div>
    </dl>
    <div class="min-w-0 space-y-2 text-xs text-zinc-500 dark:text-zinc-400" data-testid="wake-cli">
      <p>{t('worker.wake.who-settings', 'Only the worker itself, its holder, or whoever manages the App can change its mentions or pause. A pause covers every session and router of this worker.')}</p>
      {#if cli}
        <p>{t('worker.wake.cli.where', 'In the portal this is read-only for now; use the hadron CLI to change it.')}</p>
        <CliCommand label={t('worker.wake.cli.mentions-off', 'To stop waking it when mentioned:')} command={cli.mentionsOff} />
        <CliCommand label={t('worker.wake.cli.mentions-immediate', 'To wake it at once when mentioned:')} command={cli.mentionsImmediate} />
        <CliCommand label={t('worker.wake.cli.clear-pause', 'To end a pause:')} command={cli.clearPause} />
        <CliCommand label={t('worker.wake.cli.pause-until', 'To pause it until a time (RFC 3339):')} command={cli.pauseUntil} />
      {/if}
    </div>

    <div class="space-y-2">
      <h3 class="text-sm font-semibold text-zinc-900 dark:text-white">{t('worker.wake.subscriptions', 'Subscriptions')}</h3>
      {#if rows.length === 0}
        <p class="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-4 py-3 text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-300" data-testid="wake-subscriptions-empty">
          {t('worker.wake.subscriptions.empty', 'Not subscribed to any ticker.')}
        </p>
      {:else}
        <DataTable
          {table}
          listKey="worker-wake:subscriptions"
          searchPlaceholder={t('worker.wake.search', 'Search subscriptions…')}
          searchAriaLabel={t('worker.wake.search', 'Search subscriptions…')}
          bind:globalFilter
        >
          {#snippet cell(cell, row)}
            {#if cell.column.id === 'ticker'}
              <div class="flex min-w-0 flex-col">
                {#if appId}
                  <a href="/app/apps/{appId}/tickers/{row.sub.ticker.id}" class="truncate font-medium text-indigo-600 hover:underline dark:text-indigo-300">{row.sub.ticker.name}</a>
                {:else}
                  <span class="truncate font-medium">{row.sub.ticker.name}</span>
                {/if}
                {#if !row.sub.ticker.enabled}<span class="text-xs text-zinc-500">{t('app.tickers.state.disabled', 'Disabled')}</span>{/if}
                {#if row.sub.ticker.urn}<Urn value={row.sub.ticker.urn} size={9} compact linked label={t('app.tickers.urn-label', 'ticker')} />{/if}
              </div>
            {:else if cell.column.id === 'cadence'}
              <span class="whitespace-nowrap">{cadenceText(row.sub.ticker.cadenceSeconds)}</span>
            {:else if cell.column.id === 'quiet'}
              <span class="block max-w-full truncate" title={row.quiet}>{row.quiet}</span>
            {:else if cell.column.id === 'by'}
              <span class="flex min-w-0 flex-wrap items-center gap-1">
                <span class="truncate">{row.sub.createdBy?.name ?? '—'}</span>
                {#if row.sub.viaGrant}
                  <span class="rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">{t('app.ticker.via-grant', 'via grant')}</span>
                {/if}
              </span>
            {:else if cell.column.id === 'since'}
              <!-- portal#2489 (remedy b of the #1962 audit): the timestamp painted past the 170px
                   Since column; it now ellipsizes as a block with the full value in the title —
                   the same shape as the quiet cell above. -->
              {@const since = fmtRunTime(row.sub.createdAt)}
              <time datetime={row.sub.createdAt} data-testid="wake-since" class="block max-w-full truncate" title={since}>{since}</time>
            {/if}
          {/snippet}
        </DataTable>
      {/if}
    </div>
  {/if}
</section>
