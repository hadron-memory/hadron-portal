<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import DataTable from '$lib/components/table/DataTable.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import TickerForm from '$lib/components/tickers/TickerForm.svelte';
  import TickerDelete from '$lib/components/tickers/TickerDelete.svelte';
  import TickerEnabledControl from '$lib/components/tickers/TickerEnabledControl.svelte';
  import TickerAddSubscriber from '$lib/components/tickers/TickerAddSubscriber.svelte';
  import TickerRemoveSubscriber from '$lib/components/tickers/TickerRemoveSubscriber.svelte';
  import TickersNotParticipant from '$lib/components/tickers/TickersNotParticipant.svelte';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import { makeGlobalFilterFn } from '$lib/table/global-filter';
  import type { PortalColumnDef } from '$lib/table/features';
  import { fmtRunTime, parseApiDate } from '$lib/flow/runs';
  import { cadenceText, isKnownReason, isWellFormedReasons, noReasonsText, parseQuietHours, reasonHelp, reasonLabel, reasonsUnavailableText, subscriptionSearchText, unrecognisedReasonText, windowText } from '$lib/tickers/format';
  import { tickerSubscribeWhoText } from '$lib/tickers/controls';
  import type { TickerSubscriber } from '$lib/tickers/types';
  import { t } from '$lib/i18n/t';
  import type { PageData } from './$types';

  /**
   * portal#1099 — one ticker (design §3.2): its facts, then Edit and Delete
   * (portal#1151, S7b), then its subscribers.
   *
   * portal#1497 (MCP cut R7a) adds the controls the MCP cut took away: turning
   * the ticker on or off beside its badge, and Add subscriber / Remove on the
   * operations the disabled tools used. Every participant sees them (D1); the
   * server's refusal answers anyone else. The on/off control is rendered for
   * every participant; the subscriber controls sit under the list, with
   * hrn:node:hadronmemory.com:specs:cor:agt:080:20's sentence beside them (the same sentence the server's
   * SUBSCRIBE_FORBIDDEN refusal answers with).
   *
   * portal#1498's CLI commands for these same operations are gone from here
   * (D4): the controls replaced them. The Wake-ups tab keeps its commands —
   * its settings have no portal controls (D3).
   */
  let { data }: { data: PageData } = $props();

  const basePath = $derived(`/app/apps/${data.app.id}`);
  const appsHref = $derived(data.app.organizationId ? `/app/orgs/${data.app.organizationId}/apps` : '/app/apps');
  const tk = $derived(data.ticker);
  const quiet = $derived(parseQuietHours(tk.quietHours));
  const subscribers = $derived(data.subscribers);
  const task = $derived(data.tickerTask);

  interface Row {
    sub: TickerSubscriber;
    workerText: string;
    byText: string;
    sinceMs: number;
  }
  const ms = (s: string | null | undefined) => parseApiDate(s)?.getTime() ?? 0;
  const rows = $derived<Row[]>(
    subscribers.kind === 'ok' && subscribers.value
      ? subscribers.value.items.map((sub) => ({
          sub,
          workerText: [sub.worker.name, sub.worker.urn ?? ''].join(' ').trim(),
          byText: subscriptionSearchText({ name: sub.createdBy?.name, viaGrant: sub.viaGrant }),
          sinceMs: ms(sub.createdAt),
        }))
      : [],
  );

  // portal#1497: the signed-in viewer (from the layout), to scope the ticker
  // refresh marker a committed write leaves behind.
  const viewerId = $derived(data.user?.id ?? null);

  let globalFilter = $state('');
  const columns: PortalColumnDef<Row>[] = [
    { id: 'worker', accessorFn: (r) => r.workerText, header: t('app.ticker.col.worker', 'Worker'), enableHiding: false, size: 280 },
    { id: 'by', accessorFn: (r) => r.byText, header: t('app.ticker.col.by', 'Subscribed by'), size: 240 },
    { id: 'since', accessorFn: (r) => r.sinceMs, header: t('app.ticker.col.since', 'Since'), size: 170 },
    // portal#1497: each row's own Remove, whatever the roster read said.
    { id: 'actions', accessorFn: () => '', header: t('app.ticker.col.actions', 'Actions'), enableSorting: false, enableHiding: false, enableGlobalFilter: false, size: 120 },
  ];
  const fmtMs = (v: unknown) => (typeof v === 'number' && v > 0 ? fmtRunTime(String(v)) : '');
  const table = createSvelteTable<Row>({
    get data() { return rows; },
    columns,
    enableMultiSort: false,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    state: { get globalFilter() { return globalFilter; } },
    onGlobalFilterChange: (u) => { globalFilter = typeof u === 'function' ? u(globalFilter) : u; },
    globalFilterFn: makeGlobalFilterFn<Row>({ since: fmtMs }),
    initialState: { pagination: { pageIndex: 0, pageSize: 20 }, sorting: [{ id: 'since', desc: false }] },
  });

  let refreshing = $state(false);
  async function refresh() {
    refreshing = true;
    try {
      await invalidateAll();
    } finally {
      refreshing = false;
    }
  }
</script>

<svelte:head><title>{tk.name} · {t('app.tickers.head', 'Tickers')} · {data.app.name} · Hadron</title></svelte:head>

<div class="space-y-4">
  <Breadcrumb items={[
    { label: t('app.tickers.crumb.apps', 'Apps'), href: appsHref },
    { label: data.app.name, href: basePath },
    { label: t('app.tickers.crumb.tickers', 'Tickers'), href: `${basePath}/tickers` },
    { label: tk.name },
  ]} />

  <div class="space-y-1">
    <div class="flex flex-wrap items-center gap-2">
      <h1 class="text-xl font-bold text-zinc-900 dark:text-white">{tk.name}</h1>
      <span
        class="rounded-full px-2 py-0.5 text-xs font-medium {tk.enabled
          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
          : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'}"
      >{tk.enabled ? t('app.tickers.state.ticking', 'Ticking') : t('app.tickers.state.disabled', 'Disabled')}</span>
      <!-- portal#1497: the on/off control beside its badge, for every participant
           (D1); the server's refusal answers anyone else. -->
      <TickerEnabledControl appId={data.app.id} ticker={tk} after={data.after} viewerId={viewerId} impersonating={data.impersonating} />
    </div>
    {#if tk.urn}<Urn value={tk.urn} size={10} label={t('app.tickers.urn-label', 'ticker')} />{/if}
    {#if !tk.enabled}
      <p class="text-sm text-zinc-600 dark:text-zinc-400">{t('app.ticker.disabled-note', 'A disabled ticker keeps its subscribers but wakes no one.')}</p>
    {/if}
  </div>

  <dl class="grid gap-3 rounded-xl border border-zinc-200 bg-white p-4 text-sm sm:grid-cols-2 dark:border-zinc-800 dark:bg-zinc-900" data-testid="ticker-facts">
    <div class="min-w-0">
      <dt class="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{t('app.ticker.every', 'Every')}</dt>
      <dd class="text-zinc-900 dark:text-white">{cadenceText(tk.cadenceSeconds)}</dd>
    </div>
    <div class="min-w-0">
      <dt class="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{t('app.ticker.anchor', 'Counting from')}</dt>
      <dd class="text-zinc-900 dark:text-white"><time datetime={tk.anchorAt}>{fmtRunTime(tk.anchorAt)}</time></dd>
    </div>
    <div class="min-w-0">
      <dt class="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{t('app.ticker.next', 'Next tick')}</dt>
      <dd class="text-zinc-900 dark:text-white">{#if tk.nextTickAt}<time datetime={tk.nextTickAt}>{fmtRunTime(tk.nextTickAt)}</time>{:else}—{/if}</dd>
    </div>
    <div class="min-w-0">
      <dt class="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{t('app.ticker.last', 'Last tick')}</dt>
      <dd class="text-zinc-900 dark:text-white">{#if tk.lastTickAt}<time datetime={tk.lastTickAt}>{fmtRunTime(tk.lastTickAt)}</time>{:else}—{/if}</dd>
    </div>
    <div class="min-w-0 sm:col-span-2">
      <dt class="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{t('app.ticker.quiet', 'Quiet hours')}</dt>
      <dd class="text-zinc-900 dark:text-white">
        {#if quiet === null}
          {t('tickers.quiet.none', 'None')}
        {:else if quiet === 'invalid'}
          {t('tickers.quiet.invalid', 'Schedule not shown (unrecognized format)')}
        {:else}
          <ul class="space-y-0.5">
            {#each quiet.windows as w, i (i)}<li>{windowText(w)}</li>{/each}
          </ul>
          <p class="text-xs text-zinc-500 dark:text-zinc-400">{t('app.ticker.quiet.zone', 'Time zone: {zone}. No ticks inside these windows; a window includes its start and excludes its end. Mentions still make a worker due at once.', { zone: quiet.timezone })}</p>
        {/if}
      </dd>
    </div>
    <div class="min-w-0 sm:col-span-2">
      <dt class="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{t('app.ticker.reasons', 'Wakes when')}</dt>
      <dd class="text-zinc-900 dark:text-white">
        {#if !isWellFormedReasons(tk.reasons)}
          {reasonsUnavailableText()}
        {:else if tk.reasons.length === 0}
          {noReasonsText()}
        {:else}
          <ul class="space-y-1">
            {#each tk.reasons as reason (reason)}
              <li><span class="font-medium">{reasonLabel(reason)}</span>{#if !isKnownReason(reason)} <span class="text-zinc-500 dark:text-zinc-400">{unrecognisedReasonText()}</span>{/if}{#if reasonHelp(reason)}: <span class="text-zinc-600 dark:text-zinc-400">{reasonHelp(reason)}</span>{/if}</li>
            {/each}
          </ul>
          {#if tk.reasons.length > 1}<p class="text-xs text-zinc-500 dark:text-zinc-400">{t('app.ticker.reasons.any-of', 'Any one of these wakes a subscriber.')}</p>{/if}
        {/if}
      </dd>
    </div>
    <div class="min-w-0 sm:col-span-2">
      <dt class="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{t('app.ticker.counts', 'Counts')}</dt>
      <dd class="text-zinc-900 dark:text-white">
        <!-- Anne's P2 on #1136: the server lists only the named channels this reader can
             read, so [] is "names none" OR "all hidden from you". Neither is claimed. -->
        {tk.channels.length === 0
          ? t('app.ticker.counts.none-visible', 'No channel you can read is named. It counts unread in either every channel each subscriber watches, or only channels hidden from you.')
          : t('app.ticker.counts.channels', 'Unread in {channels}', { channels: tk.channels.map((c) => c.name).join(', ') })}
        ·
        {tk.relevance === 'MENTIONS'
          ? t('app.ticker.relevance.mentions', 'Mentions only: makes a subscriber due only when it has an unread mention there.')
          : t('app.ticker.relevance.all', 'All unread: makes a subscriber due when it has unread messages in these channels.')}
      </dd>
    </div>
    <!-- portal#1384: the loc and code are shown as the server returned them. A loc is not a URN: no
         chip, no link, nothing resolved. A null loc is "no entry" or "an entry you can't read", and
         the copy claims no more. 'not-participant' and a null ticker say nothing about the mapping,
         so they render no entry at all. -->
    {#if task.kind === 'failed' || (task.kind === 'ok' && task.value)}
      <div class="min-w-0 sm:col-span-2" data-testid="ticker-task">
        <dt class="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{t('app.ticker.task', 'Task')}</dt>
        <dd class="min-w-0 text-zinc-900 dark:text-white">
          {#if task.kind === 'failed'}
            <span role="alert" class="text-red-800 dark:text-red-300">
              {t('app.ticker.task.failed', 'Couldn’t load this ticker’s task.')}
              <button type="button" onclick={refresh} class="ml-2 font-medium underline">{t('app.tickers.retry', 'Try again')}</button>
            </span>
          {:else if task.value?.registerTaskLoc}
            <code class="break-all font-mono text-xs select-all">{task.value.registerTaskLoc}</code>
            <p class="text-xs text-zinc-500 dark:text-zinc-400">{t('app.ticker.task.each-worker', 'Each worker runs the task at this location in its own role, or the shared one.')}</p>
          {:else}
            {t('app.ticker.task.none', 'No task you can see is mapped to this ticker.')}
            <p class="text-xs text-zinc-500 dark:text-zinc-400">{t('app.ticker.task.fix', 'To hand its workers a task, map this code in the team Agent’s system memory.')}</p>
          {/if}
          {#if tk.tickCode}
            <p class="text-xs text-zinc-500 dark:text-zinc-400">{t('app.ticker.task.code', 'Code:')} <code class="break-all font-mono select-all">{tk.tickCode}</code></p>
          {/if}
        </dd>
      </div>
    {/if}
    <div class="min-w-0">
      <dt class="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{t('app.ticker.owner', 'Owner')}</dt>
      <dd class="min-w-0 text-zinc-900 dark:text-white">
        {#if tk.owner}
          {tk.owner.name}
          {#if tk.owner.urn}<Urn value={tk.owner.urn} size={9} compact linked />{/if}
        {:else}—{/if}
      </dd>
    </div>
    <div class="min-w-0">
      <dt class="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{t('app.ticker.created', 'Created')}</dt>
      <dd class="text-zinc-900 dark:text-white">
        <time datetime={tk.createdAt}>{fmtRunTime(tk.createdAt)}</time>
        {#if tk.updatedAt}<span class="text-zinc-500 dark:text-zinc-400"> · {t('app.ticker.updated', 'updated {time}', { time: fmtRunTime(tk.updatedAt) })}</span>{/if}
      </dd>
    </div>
  </dl>
  <!-- portal#1497 (D4): the MCP-tools pointer is gone, and so is portal#1498's
       CLI block for these operations — the controls above and below are it.
       `app.ticker.who` (hrn:node:hadronmemory.com:specs:cor:agt:080:18) stays the governing line for On/off;
       the subscriber controls carry their own (hrn:node:hadronmemory.com:specs:cor:agt:080:20). -->
  <p class="text-xs text-zinc-500 dark:text-zinc-400">{t('app.ticker.who', 'Only its owner, the owning worker’s holder, or whoever manages the App can change this ticker.')}</p>

  <section aria-labelledby="ticker-edit-heading" class="space-y-3" data-testid="ticker-edit">
    <h2 id="ticker-edit-heading" class="text-sm font-semibold text-zinc-900 dark:text-white">{t('app.ticker.edit.heading', 'Edit ticker')}</h2>
    <TickerForm appId={data.app.id} ticker={tk} impersonating={data.impersonating} />
    <TickerDelete appId={data.app.id} ticker={tk} impersonating={data.impersonating} />
  </section>

  <section aria-labelledby="subscribers-heading" class="space-y-2">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h2 id="subscribers-heading" class="text-sm font-semibold text-zinc-900 dark:text-white">{t('app.ticker.subscribers', 'Subscribers')}</h2>
      <button
        type="button"
        onclick={refresh}
        disabled={refreshing}
        class="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >{t('app.tickers.refresh', 'Refresh')}</button>
    </div>
    {#if subscribers.kind !== 'not-participant'}
      <!-- portal#1497: hrn:node:hadronmemory.com:specs:cor:agt:080:20, the same sentence the server's
           SUBSCRIBE_FORBIDDEN refusal answers with (one copy, $lib/tickers/controls).
           A non-participant is offered nothing here (the roster's "not offered"
           state): the not-participant box below is all they see. -->
      <p class="text-xs text-zinc-500 dark:text-zinc-400" data-testid="ticker-subscriber-who">{tickerSubscribeWhoText()}</p>
      <TickerAddSubscriber appId={data.app.id} ticker={tk} roster={data.roster} viewerId={viewerId} impersonating={data.impersonating} onRosterRetry={refresh} />
    {/if}
    {#if subscribers.kind === 'not-participant'}
      <TickersNotParticipant impersonating={data.impersonating} />
    {:else if subscribers.kind === 'failed'}
      <div role="alert" class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
        {t('app.ticker.subscribers.failed', 'Couldn’t load this ticker’s subscribers.')}
        <button type="button" onclick={refresh} class="ml-2 font-medium underline">{t('app.tickers.retry', 'Try again')}</button>
      </div>
    {:else if rows.length === 0 && !data.paged}
      <p role="status" class="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-4 py-3 text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-300" data-testid="subscribers-empty">
        {t('app.ticker.subscribers.empty', 'Nobody follows this ticker yet.')}
      </p>
    {:else}
      <DataTable
        {table}
        listKey="app-ticker:subscribers"
        searchPlaceholder={t('app.ticker.subscribers.search', 'Search subscribers…')}
        searchAriaLabel={t('app.ticker.subscribers.search', 'Search subscribers…')}
        bind:globalFilter
        maxHeight="max(200px, calc(100vh - 30rem))"
      >
        {#snippet cell(cell, row)}
          {#if cell.column.id === 'worker'}
            <div class="flex min-w-0 flex-col">
              <a href="/app/workers/{row.sub.worker.id}?tab=wake" class="truncate font-medium text-indigo-600 hover:underline dark:text-indigo-300">
                {row.sub.worker.name}
              </a>
              {#if row.sub.worker.urn}<Urn value={row.sub.worker.urn} size={9} compact linked />{/if}
            </div>
          {:else if cell.column.id === 'by'}
            <!-- hrn:node:hadronmemory.com:specs:cor:agt:080:02: the subscription records its creator, not the role it acted in, so no role label. -->
            <span class="flex min-w-0 flex-wrap items-center gap-1">
              <span class="truncate">{row.sub.createdBy?.name ?? '—'}</span>
              {#if row.sub.viaGrant}
                <span class="rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">{t('app.ticker.via-grant', 'via grant')}</span>
              {/if}
            </span>
          {:else if cell.column.id === 'since'}
            <time datetime={row.sub.createdAt} class="whitespace-nowrap">{fmtRunTime(row.sub.createdAt)}</time>
          {:else if cell.column.id === 'actions'}
            <!-- portal#1497: the row's own Remove, kept whatever the roster read
                 said — a worker the chooser doesn't list may still be subscribed. -->
            <TickerRemoveSubscriber appId={data.app.id} ticker={tk} subscription={row.sub} worker={row.sub.worker} viewerId={viewerId} impersonating={data.impersonating} />
          {/if}
        {/snippet}
      </DataTable>
      <!-- Forward paging only: the server has no total and no backward cursor. -->
      <nav aria-label={t('app.ticker.subscribers.paging', 'Subscriber pages')} class="flex flex-wrap gap-3 text-sm">
        {#if data.paged}
          <a href="{basePath}/tickers/{tk.id}" class="text-indigo-600 hover:underline dark:text-indigo-300">{t('app.ticker.subscribers.first', 'First subscribers')}</a>
        {/if}
        {#if subscribers.kind === 'ok' && subscribers.value?.hasNextPage && subscribers.value.endCursor}
          <a href="{basePath}/tickers/{tk.id}?after={encodeURIComponent(subscribers.value.endCursor)}" class="text-indigo-600 hover:underline dark:text-indigo-300" data-testid="subscribers-more">
            {t('app.ticker.subscribers.more', 'More subscribers')}
          </a>
        {/if}
      </nav>
    {/if}
  </section>
</div>
