<!--
  portal#1462 — the Wake-ups tab's manager action: apply the Agent's ticker
  templates to this worker (hadron-server#2860;
  hrn:node:hadronmemory.com:hadron-dev-team-victor:drafts:080:080-34).

  - Offered unless the page KNOWS the viewer does not manage the App (an
    explicit `canManage === false`), as the boot-prompt pointer form is. It is
    a presentation hint: the server decides who may, and a refusal is shown.
  - One POST, no fields: the route names the worker. Never automatic, never
    retried here.
  - The receipt prints the EFFECTIVE cadence only. The result does not carry the
    template's declared one, so "the App's floor" appears on equality with the
    floor and nothing ever says "raised" (Xavier's gate delta 2).
  - A refusal says "nothing was created" only for the two the server refuses
    whole; anything else is outcome-unknown, with a hint to refresh.
  - The receipt's rows are the shared grid (DataTable), not bespoke lists.
  - A result belongs to the MOUNT that sent it (George's P2s on #1464). The page
    is reused across workers, and kit's own pathname guard passes again on
    A → B → A, so a late result is fenced here, BEFORE `update`: a mount that is
    no longer the live one applies nothing, and only refreshes the loader when
    the reader is back on the worker it was written for.
  - One live region is mounted before any result, and focus moves to it after
    one (kit's applyAction resets focus to the body), unless the reader has
    already moved to another control (Uma's P2/P3 on #1464).
-->
<script module lang="ts">
  // The mount that is showing a panel right now. Client-only: it is set in onMount.
  let live: { id: number; key: string } | null = null;
  let sequence = 0;
</script>
<script lang="ts">
  import { onDestroy, onMount, tick, untrack } from 'svelte';
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import DataTable from '$lib/components/table/DataTable.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import { makeGlobalFilterFn } from '$lib/table/global-filter';
  import type { PortalColumnDef } from '$lib/table/features';
  import { floorLabel, type AppliedTicker, type ApplyResult } from '$lib/tickers/apply';
  import { cadenceText } from '$lib/tickers/format';
  import { t } from '$lib/i18n/t';

  let {
    canManage,
    action,
    workerKey,
    result = null,
    floorSeconds = null,
  }: {
    canManage: boolean | null;
    action: string;
    /** The route's identity for this worker (what the action keys its result with), never the loaded worker's id. */
    workerKey: string;
    result?: ApplyResult | null;
    floorSeconds?: number | null;
  } = $props();

  // A result written for another route (the page is reused across /workers/A → B) is not this one's.
  const shown = $derived(result && result.key === workerKey ? result : null);
  let submitting = $state(false);
  // The worker (route key) whose apply succeeded but whose page refresh then failed. Set only by the live mount,
  // and shown only while that worker is the one in view (George's, Uma's and Cedar's P2 on 3cc623de).
  let refreshFailedFor = $state<string | null>(null);
  let region = $state<HTMLElement | null>(null);
  let button = $state<HTMLButtonElement | null>(null);

  const mine = ++sequence;
  const originKey = untrack(() => workerKey);
  onMount(() => {
    live = { id: mine, key: originKey };
  });
  onDestroy(() => {
    if (live?.id === mine) live = null;
  });

  /**
   * Where the reader's focus went while the request ran, if anywhere else. Kit's `applyAction` resets
   * focus to the body BEFORE the callback's `await update` resolves, which erases the evidence, so the
   * choice is recorded as it happens (George's P2 on the delta of #1464). The body itself, which the
   * reset focuses, never counts, and neither does this panel's own form or result region.
   */
  function watchFocus(formElement: HTMLElement) {
    let moved: HTMLElement | null = null;
    const onFocusIn = (e: FocusEvent) => {
      const el = e.target;
      if (!(el instanceof HTMLElement) || el === document.body) return;
      moved = formElement.contains(el) || region?.contains(el) ? null : el;
    };
    document.addEventListener('focusin', onFocusIn);
    return { stop: () => document.removeEventListener('focusin', onFocusIn), chosen: () => moved };
  }

  async function settleFocus(chosen: HTMLElement | null) {
    await tick();
    // A control the reader chose survives kit's reset: put focus back on it, never on the receipt.
    if (chosen && chosen.isConnected) {
      chosen.focus({ preventScroll: true });
      return;
    }
    const active = document.activeElement;
    if (!active || active === document.body || active === button) region?.focus();
  }

  const submit = ({ cancel, formElement }: { cancel: () => void; formElement: HTMLFormElement }) => {
    if (submitting) {
      cancel();
      return;
    }
    submitting = true;
    refreshFailedFor = null;
    const focus = watchFocus(formElement);
    return async ({ result, update }: { result: { type: string }; update: (o?: { reset?: boolean; invalidateAll?: boolean }) => Promise<void> }) => {
      try {
        if (live?.id !== mine) {
          // This mount is gone (the reader moved on, perhaps A → B → A). Its result is not applied to any
          // panel; the loader is refreshed only when the reader is back on the worker it was written for.
          if (live && live.key === originKey) await invalidateAll();
          return;
        }
        // Kit refreshes before it applies a success, and what follows that await is decided by its
        // pathname check alone, which passes again on A → B → A. So the refresh is done HERE, and the
        // fence is checked again after it, before anything is applied.
        // A refresh that fails does not undo the apply: the result is still applied below and the reader is told
        // the page could not reload. The apply is never retried from here.
        let refreshFailed = false;
        if (result.type === 'success') {
          try {
            await invalidateAll();
          } catch {
            refreshFailed = true;
          }
          if (live?.id !== mine) return;
        }
        await update({ reset: false, invalidateAll: false });
        if (refreshFailed) refreshFailedFor = originKey;
        submitting = false;
        await settleFocus(focus.chosen());
      } finally {
        // Whatever happened (a refresh that rejected, a stale mount, a failed update), the next apply must be possible.
        submitting = false;
        focus.stop();
      }
    };
  };

  // The receipt's rows, in the shared grid.
  interface CreatedRow { c: AppliedTicker; text: string; cadence: number }
  interface PresentRow { id: string; name: string }
  const createdRows = $derived<CreatedRow[]>(
    shown && shown.ok ? shown.created.map((c) => ({ c, text: [c.tickerName, c.tickerUrn ?? ''].filter(Boolean).join(' '), cadence: c.effectiveCadenceSeconds })) : [],
  );
  const presentRows = $derived<PresentRow[]>(shown && shown.ok ? shown.alreadyPresent : []);
  let createdFilter = $state('');
  let presentFilter = $state('');
  const createdColumns: PortalColumnDef<CreatedRow>[] = [
    { id: 'ticker', accessorFn: (r) => r.text, header: t('worker.apply.col.ticker', 'Ticker'), enableHiding: false, size: 260 },
    { id: 'template', accessorFn: (r) => r.c.templateName, header: t('worker.apply.col.template', 'From template'), size: 180 },
    { id: 'every', accessorFn: (r) => r.cadence, header: t('worker.apply.col.every', 'Every'), size: 140 },
  ];
  const presentColumns: PortalColumnDef<PresentRow>[] = [
    { id: 'template', accessorFn: (r) => r.name, header: t('worker.apply.col.present', 'Template'), enableHiding: false, size: 300 },
  ];
  const createdTable = createSvelteTable<CreatedRow>({
    get data() { return createdRows; },
    columns: createdColumns,
    enableMultiSort: false,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    state: { get globalFilter() { return createdFilter; } },
    onGlobalFilterChange: (u) => { createdFilter = typeof u === 'function' ? u(createdFilter) : u; },
    globalFilterFn: makeGlobalFilterFn<CreatedRow>({ every: (v) => (typeof v === 'number' ? cadenceText(v) : '') }),
    initialState: { pagination: { pageIndex: 0, pageSize: 20 } },
  });
  const presentTable = createSvelteTable<PresentRow>({
    get data() { return presentRows; },
    columns: presentColumns,
    enableMultiSort: false,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    state: { get globalFilter() { return presentFilter; } },
    onGlobalFilterChange: (u) => { presentFilter = typeof u === 'function' ? u(presentFilter) : u; },
    globalFilterFn: makeGlobalFilterFn<PresentRow>({}),
    initialState: { pagination: { pageIndex: 0, pageSize: 20 } },
  });
</script>

{#if canManage !== false}
  <section class="space-y-3 rounded-xl border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900" data-testid="apply-tickers" aria-labelledby="apply-tickers-title">
    <h3 id="apply-tickers-title" class="text-sm font-semibold text-zinc-900 dark:text-white">{t('worker.apply.title', 'Agent tickers')}</h3>
    <p class="text-xs text-zinc-500 dark:text-zinc-400">
      {t('worker.apply.help', 'Adds the tickers this worker’s Agent declares that it doesn’t have yet. Existing tickers and subscriptions are left as they are.')}
    </p>
    <form method="POST" {action} use:enhance={submit}>
      <button
        type="submit"
        bind:this={button}
        aria-disabled={submitting ? 'true' : undefined}
        aria-describedby="apply-tickers-result"
        class="rounded-md bg-indigo-600 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-500 aria-disabled:opacity-50"
      >{submitting ? t('worker.apply.pending', 'Adding…') : t('worker.apply.button', 'Apply the Agent’s tickers')}</button>
    </form>

    <!-- Mounted before any result, so a screen reader is already watching it; focus moves here after an apply. -->
    <div id="apply-tickers-result" bind:this={region} tabindex="-1" aria-live="polite" class="space-y-2 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500">
      {#if shown && 'refusal' in shown}
        <div role="alert" class="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300" data-testid="apply-refusal">
          <p>{shown.refusal.message}</p>
          {#if shown.refusal.code}<code class="font-mono opacity-80">{shown.refusal.code}</code>{/if}
        </div>
      {:else if shown}
        <div role="status" class="space-y-3 rounded-md border border-green-300 bg-green-50 px-3 py-2 text-xs text-green-900 dark:border-green-900 dark:bg-green-950 dark:text-green-200" data-testid="apply-receipt">
          {#if shown.created.length === 0}
            <p>{t('worker.apply.none', 'Nothing to create: this worker already has every ticker its Agent declares.')}</p>
          {:else}
            <div class="space-y-1.5">
              <p class="font-semibold">
                {shown.created.length === 1
                  ? t('worker.apply.created-one', 'Created 1 ticker:')
                  : t('worker.apply.created', 'Created {n} tickers:', { n: shown.created.length })}
              </p>
              <DataTable
                table={createdTable}
                listKey="worker-wake:apply-created"
                searchPlaceholder={t('worker.apply.search', 'Search the receipt…')}
                searchAriaLabel={t('worker.apply.search', 'Search the receipt…')}
                bind:globalFilter={createdFilter}
                maxHeight="max(120px, 40vh)"
              >
                {#snippet cell(cell, row)}
                  {#if cell.column.id === 'ticker'}
                    <div class="flex min-w-0 flex-col">
                      <span class="font-medium break-words">{row.c.tickerName}</span>
                      {#if row.c.tickerUrn}<Urn value={row.c.tickerUrn} size={9} compact linked label={t('app.tickers.urn-label', 'ticker')} />{/if}
                    </div>
                  {:else if cell.column.id === 'template'}
                    <span class="break-words">{row.c.templateName}</span>
                  {:else if cell.column.id === 'every'}
                    {@const label = floorLabel(row.c.effectiveCadenceSeconds, floorSeconds)}
                    <span class="whitespace-nowrap">{cadenceText(row.c.effectiveCadenceSeconds)}{#if label}&nbsp;({label}){/if}</span>
                  {/if}
                {/snippet}
              </DataTable>
            </div>
          {/if}
          {#if shown.alreadyPresent.length > 0}
            <div class="space-y-1.5">
              <p class="font-semibold">{t('worker.apply.already', 'Already had:')}</p>
              <DataTable
                table={presentTable}
                listKey="worker-wake:apply-present"
                searchPlaceholder={t('worker.apply.search', 'Search the receipt…')}
                searchAriaLabel={t('worker.apply.search', 'Search the receipt…')}
                bind:globalFilter={presentFilter}
                maxHeight="max(120px, 40vh)"
              >
                {#snippet cell(cell, row)}
                  {#if cell.column.id === 'template'}<span class="break-words">{row.name}</span>{/if}
                {/snippet}
              </DataTable>
            </div>
          {/if}
        </div>
      {/if}
      {#if shown && refreshFailedFor === workerKey}
        <p role="status" class="text-xs text-amber-800 dark:text-amber-300" data-testid="apply-refresh-failed">
          {t('worker.apply.refresh-failed', 'The tickers were applied, but this page could not reload to show the worker’s current list. Reload the page to see it; applying again is not needed.')}
        </p>
      {/if}
    </div>
  </section>
{/if}
