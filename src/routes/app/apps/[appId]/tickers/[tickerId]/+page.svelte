<script lang="ts">
  import { untrack } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import DataTable from '$lib/components/table/DataTable.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import TickerForm from '$lib/components/tickers/TickerForm.svelte';
  import TickerDelete from '$lib/components/tickers/TickerDelete.svelte';
  import TickerEnabledControl from '$lib/components/tickers/TickerEnabledControl.svelte';
  import TickerAddSubscriber from '$lib/components/tickers/TickerAddSubscriber.svelte';
  import TickerRemoveSubscriber from '$lib/components/tickers/TickerRemoveSubscriber.svelte';
  import TickerRemoveOutcomeLine from '$lib/components/tickers/TickerRemoveOutcomeLine.svelte';
  import TickersNotParticipant from '$lib/components/tickers/TickersNotParticipant.svelte';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import { makeGlobalFilterFn } from '$lib/table/global-filter';
  import type { PortalColumnDef } from '$lib/table/features';
  import { fmtRunTime, parseApiDate } from '$lib/flow/runs';
  import { cadenceText, isKnownReason, isWellFormedReasons, noReasonsText, parseQuietHours, reasonHelp, reasonLabel, reasonsUnavailableText, subscriptionSearchText, unrecognisedReasonText, windowText } from '$lib/tickers/format';
  import { tickerSubscribeWhoText, type TickerRemoveOutcome } from '$lib/tickers/controls';
  import { takeTickerRemoveOutcomeMarker } from '$lib/tickers/ticker-remove-outcome-marker';
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

  // portal#1502 (review, Uma P2): the Remove confirmation never fit the Actions
  // column (a 278px form in a 120px cell; Cancel was clipped at 390 and 1280),
  // so it is a page-level PANEL above the table, opened by the row's trigger —
  // the Add control's own shape. The page owns which row's panel is open, the
  // focus contract, and muting every other row's trigger while a removal is in
  // flight (a swallowed result is exactly the late-result bug the control
  // exists to prevent).
  let removingId = $state<string | null>(null);
  let removeBusy = $state(false);
  // portal#1502 (delta seats): a removal's outcome belongs to the PAGE. The
  // reload a committed removal (or the stale-row SUBSCRIPTION_NOT_FOUND
  // refusal) performs drops the row, and the row is what keeps the Remove
  // panel mounted — so "Removed", the stale-row sentence, the announcement
  // caveat and the refresh line all vanished with the panel at the last head
  // (Gemma + Gaby, independently proven). The panel reports through onOutcome
  // once its reload has settled; this state is what survives it.
  let removeOutcome = $state<TickerRemoveOutcome | null>(null);
  // The row whose Remove was last opened (plain, not $state: nothing renders
  // from it). The page checks every arriving outcome against it, so the
  // contract on TickerRemoveOutcome — a late result of another row attaches
  // to nothing — is enforced HERE, not just by the busy-muting that makes a
  // mid-flight row switch impossible (portal#1502 delta, Gemma P3-a).
  let removeOpenedFor: string | null = null;
  // $state, not a plain object: `bind:this` writes into it every row render,
  // and a non-reactive target is the runtime warning Svelte raises per row
  // (portal#1502 delta, Gemma P3-1). Focus restore still reads it imperatively.
  const removeTriggers: Record<string, HTMLButtonElement | null> = $state({});
  let subscribersHeading: HTMLHeadingElement | null = $state(null);
  const removingRow = $derived(removingId === null ? null : rows.find((r) => r.sub.id === removingId) ?? null);
  // The panel renders from the subscription it was OPENED for, not from the
  // live row lookup: the reload a removal performs can take the row out of
  // `rows` a flush before this template tears the panel down, and a prop read
  // through `removingRow` would throw in that window (portal#1502 delta —
  // both reload paths proved it). The row-gone effect below closes the panel.
  let removePanelSub = $state<TickerSubscriber | null>(null);
  // While the panel that produced an outcome is still open, the panel shows
  // its own result line and this region stays empty — one announcement, not
  // two. The region itself is present (and empty) from first paint, so the
  // sentence that lands in it is announced as a change.
  //
  // portal#1502 (BLIND delta, Gaby P2): the outcome also belongs to ONE
  // TICKER. Kit reuses this page component for the next ticker under the
  // route, so `data.ticker` can swap in place under any state this page
  // holds — without this fence, a removal of ticker A would leave "Removed"
  // in ticker B's status region, claiming a removal that never happened on
  // B (the page-state twin of the reused-[id]-route bleed
  // hrn:node:hadronmemory.com:hadron-portal:review:superforms-late-result-crosses-entity-navigation
  // fences in superForm ids). The panel below is already keyed per
  // subscription; this guard is the page-level half of that fence.
  function showsOutcome(o: TickerRemoveOutcome | null): o is TickerRemoveOutcome {
    return o !== null && o.tickerId === tk.id && removePanelSub === null;
  }
  const removeOutcomeText = $derived(showsOutcome(removeOutcome) ? removeOutcome.text : '');
  const removeOutcomeAnnouncement = $derived(showsOutcome(removeOutcome) && removeOutcome.announcementFailed);
  const removeOutcomeRefreshFailed = $derived(showsOutcome(removeOutcome) && removeOutcome.refreshFailed);

  /** Cancel/Escape: close the panel and refocus the row's own trigger. */
  function closeRemove() {
    const was = removingId;
    removingId = null;
    removePanelSub = null;
    if (was !== null) removeTriggers[was]?.focus({ preventScroll: true });
  }

  // A reload that took the open row away (a committed removal, or the
  // stale-row SUBSCRIPTION_NOT_FOUND reload) ends the panel: focus lands on
  // the Subscribers heading, not nowhere (portal#1502 review, Uma P3-2).
  $effect(() => {
    if (removingId !== null && removingRow === null) {
      removingId = null;
      removePanelSub = null;
      subscribersHeading?.focus({ preventScroll: true });
    }
  });

  // portal#1502 (BLIND delta, Gaby P2 + Uma P3-2): the fence above hides an
  // outcome on the wrong ticker; this one stops it RESURFACING if the reader
  // comes back — cleared, not merely hidden. The guard reads removeOutcome,
  // but the write makes the guard false (an effect re-run sees null and
  // stops), so this converges rather than latching — the case
  // hrn:node:hadronmemory.com:hadron-portal:review:no-read-modify-write-state-in-effect
  // distinguishes. Tracked on the scalar id, so a same-ticker refresh that
  // replaces the data object clears nothing.
  $effect(() => {
    const current = tk.id;
    if (removeOutcome !== null && removeOutcome.tickerId !== current) removeOutcome = null;
  });

  // portal#1502 (Colette QA delta): a stale-row refusal's reload can end in a
  // full document FALLBACK (an aborted data refresh does not reject in a real
  // kit) — the fresh first page it lands on is this component, mounted anew
  // with every client state gone, and the server's refusal sentence reaches
  // it only through the outcome marker the panel left behind. Taken once
  // here, on THIS viewer's render of the same ticker, into the same
  // always-present region above (so it is announced as a change, never
  // inserted already-populated — Gaby P3-1). A live navigation never gets
  // this far: the panel clears its marker at settlement, so the sentence and
  // the corrected failed-reload copy never both apply. FIRST PAGE ONLY
  // (28b680ce review): the sentence says "the list is back at its first
  // page", so a paginated view — where it is not — may not claim it; the
  // marker is left in place for a first-page arrival inside its window. The
  // gate is the LOADER's own first-page signal, `paged` (efae752b review,
  // Gemma P2: ?after= spells a falsy after:"" with paged:true — `after`
  // itself cannot carry this condition).
  $effect(() => {
    const viewer = viewerId;
    const appIdNow = data.app.id;
    const current = tk.id;
    if (!viewer || !appIdNow || !current || data.paged) return;
    untrack(() => {
      const claim = takeTickerRemoveOutcomeMarker({ viewer, appId: appIdNow, tickerId: current });
      if (claim) {
        removeOutcome = { tickerId: current, subscriptionId: claim.subscriptionId, text: claim.sentence, workerUrn: null, announcementFailed: false, refreshFailed: false };
      }
    });
  });
</script>

<svelte:head><title>{tk.name} · {t('app.tickers.head', 'Tickers')} · {data.app.name} · Hadron</title></svelte:head>

<div class="space-y-4">
  <Breadcrumb items={[
    { label: t('app.tickers.crumb.apps', 'Apps'), href: appsHref },
    { label: data.app.name, href: basePath },
    { label: t('app.tickers.crumb.tickers', 'Tickers'), href: `${basePath}?tab=settings&section=tickers` },
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
              <button type="button" onclick={refresh} class="ml-2 py-1 font-medium underline">{t('app.tickers.retry', 'Try again')}</button>
            </span>
          {:else if task.value?.registerTaskLoc}
            <code class="break-all font-mono text-xs select-all">{task.value.registerTaskLoc}</code>
            <p class="text-xs text-zinc-500 dark:text-zinc-400">{t('app.ticker.task.each-worker', 'Each woken worker looks up the nearest readable runnable task in its Agent chain.')}</p>
          {:else}
            {t('app.ticker.task.none', 'No task you can see is mapped to this ticker.')}
            <p class="text-xs text-zinc-500 dark:text-zinc-400">{t('app.ticker.task.fix', 'To hand its workers a task, map this code in the team Agent’s system memory.')}</p>
          {/if}
          {#if tk.tickCode}
            <p class="text-xs text-zinc-500 dark:text-zinc-400">{t('app.ticker.task.code', 'Ticker code:')} <code class="break-all font-mono select-all">{tk.tickCode}</code></p>
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

  <section aria-labelledby="ticker-edit-heading" class="space-y-3" data-testid="ticker-edit-section">
    <h2 id="ticker-edit-heading" class="text-sm font-semibold text-zinc-900 dark:text-white">{t('app.ticker.edit.heading', 'Edit ticker')}</h2>
    <TickerForm appId={data.app.id} ticker={tk} impersonating={data.impersonating} />
    <TickerDelete appId={data.app.id} ticker={tk} impersonating={data.impersonating} />
  </section>

  <section aria-labelledby="subscribers-heading" class="space-y-2">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h2 id="subscribers-heading" tabindex="-1" bind:this={subscribersHeading} class="text-sm font-semibold text-zinc-900 dark:text-white">{t('app.ticker.subscribers', 'Subscribers')}</h2>
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
      <!-- portal#1502 (review): the impersonation note is ONE page-level line
           for the table's Remove triggers (it was one per row); the Add control
           carries its own beside itself. -->
      {#if data.impersonating}
        <p class="text-xs text-zinc-500 dark:text-zinc-400">{t('app.tasks.write.impersonating', 'Viewing as {name}: changes are switched off in a support session.', { name: data.impersonating })}</p>
      {/if}
      <!-- The Remove outcome, at page level: it outlives the panel below (the
           reload that carries it drops the row the panel is mounted on). Empty
           — and present — from first paint, so the sentence that lands in it is
           announced as a change, never swapped in. The caveat and refresh
           lines render INSIDE it for the same reason (portal#1502 BLIND delta,
           Gaby P3: an element inserted already-populated beside the region is
           not announced), and so does the worker's Urn chip — once the row is
           gone, this sentence is the only thing that names whom (Uma P3-1 /
           Gaby P3-2, per hrn:node:hadronmemory.com:hadron-portal:review:render-urn).
           Each caveat is its OWN LINE (block), still inside the region: inline
           after the chip they ran into it and into each other —
           "stands.Saved;" (portal#1502 UX delta, Uma P2). Its own component
           (not page markup) so the layout harness can mount the populated
           region directly — a populated outcome needs a delivered action
           result, which a page mounted outside kit cannot produce. The
           fallback case (Colette QA delta) is the exception that proves that
           last clause: there the outcome arrives through the marker, not an
           action result, and lands here the same way. -->
      <TickerRemoveOutcomeLine text={removeOutcomeText} workerUrn={showsOutcome(removeOutcome) ? removeOutcome.workerUrn : null} announcementFailed={removeOutcomeAnnouncement} refreshFailed={removeOutcomeRefreshFailed} />
      <!-- The Remove panel, above the table beside Add: one removal at a time,
           whatever the roster read said (the row keeps its trigger). KEYED on
           the subscription: another row's Remove starts from a fresh instance —
           one panel never carries one row's refusal into another row's
           confirmation (portal#1502 delta, Gaby + Uma). -->
      {#if removePanelSub}
        {#key removePanelSub.id}
          <TickerRemoveSubscriber
            appId={data.app.id}
            ticker={tk}
            subscription={removePanelSub}
            worker={removePanelSub.worker}
            viewerId={viewerId}
            onClose={closeRemove}
            onOutcome={(outcome) => { if (outcome.subscriptionId === removeOpenedFor && outcome.tickerId === tk.id) removeOutcome = outcome; }}
            bind:busy={removeBusy}
          />
        {/key}
      {/if}
    {/if}
    {#if subscribers.kind === 'not-participant'}
      <TickersNotParticipant impersonating={data.impersonating} />
    {:else if subscribers.kind === 'failed'}
      <div role="alert" class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
        {t('app.ticker.subscribers.failed', 'Couldn’t load this ticker’s subscribers.')}
        <button type="button" onclick={refresh} class="ml-2 py-1 font-medium underline">{t('app.tickers.retry', 'Try again')}</button>
      </div>
    {:else if rows.length === 0 && !data.paged}
      <p class="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-4 py-3 text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-300" data-testid="subscribers-empty">
        {t('app.ticker.subscribers.empty', 'Nobody follows this ticker yet.')}
      </p>
    {:else}
      <DataTable
        {table}
        listKey="app-ticker:subscribers"
        searchPlaceholder={t('app.ticker.subscribers.search', 'Search subscribers…')}
        searchAriaLabel={t('app.ticker.subscribers.search', 'Search subscribers…')}
        bind:globalFilter
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
            <!-- portal#1497: the row's own Remove trigger, kept whatever the
                 roster read said — a worker the chooser doesn't list may still
                 be subscribed. portal#1502 (review): the confirmation is the
                 page-level panel above the table, so the cell holds only the
                 trigger, muted while any removal is in flight. An impersonation
                 session renders no trigger at all (the page-level note says
                 why) — the server refuses the POST anyway. -->
            {#if data.impersonating}
              <span class="text-zinc-400 dark:text-zinc-500">—</span>
            {:else}
              <button
                type="button"
                bind:this={removeTriggers[row.sub.id]}
                onclick={() => { removeOutcome = null; removeOpenedFor = row.sub.id; removingId = row.sub.id; removePanelSub = row.sub; }}
                disabled={removeBusy}
                aria-expanded={removingId === row.sub.id}
                aria-controls={removingId === row.sub.id ? 'ticker-remove-panel-' + row.sub.id : undefined}
                data-testid={"ticker-remove-" + row.sub.id}
                class="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >{t('app.ticker.controls.remove.start', 'Remove…')}</button>
            {/if}
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
