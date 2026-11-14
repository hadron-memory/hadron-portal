<script lang="ts">
  import { onDestroy, tick, untrack } from 'svelte';
  import { t } from '$lib/i18n/t';
  import DataTable from '$lib/components/table/DataTable.svelte';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import type { PortalColumnDef } from '$lib/table/features';
  import { FINDINGS_PROVIDER_MAX, findingTextParts, nextFindingsOffset, parseFindingsPage, type Finding, type FindingsPage, type FindingsRead } from '$lib/agent-tasks/findings';

  /**
   * portal#1637 — a finished task's immutable findings, read-only, after Result.
   *
   * One page at a time (the server pages it; hasMore is the only thing that
   * enables Next, and the next offset is the SERVED row count). The section owns
   * its requests: no invalidateAll, no mutation, no polling. Every response is
   * applied only if the identity and request generation it was issued under are
   * still current, so a late answer for task A never paints task B.
   *
   * `initial` is the loader's own first read (a promise, so the section never
   * blocks the rest of the page); a failure arrives as a VALUE, never empty.
   */
  let { appId, taskId, initial }: { appId: string; taskId: string; initial: Promise<FindingsRead> | FindingsRead } = $props();

  type View = { kind: 'loading' } | { kind: 'no-result' } | { kind: 'unavailable' } | { kind: 'failed' } | { kind: 'page'; page: FindingsPage };
  /** The page a request was issued for, and the Previous trail that applies once it succeeds. */
  type Request = { offset: number; history: number[] };

  let view = $state.raw<View>({ kind: 'loading' });
  /** Offsets of successfully read earlier pages, so Previous returns to a page that really was served. */
  let history = $state.raw<number[]>([]);
  let pending = $state(false);
  /** The last request failed: Retry repeats exactly this one. A page on screen is then only retained data. */
  let failure = $state.raw<Request | null>(null);
  let heading: HTMLHeadingElement | undefined = $state();

  /**
   * Finding id → its ABSOLUTE position (page offset + index) in this identity's read. The list is
   * append-only and its order is stable (findings are immutable and never reordered), so an id sits at
   * exactly one position however the provider cuts its pages; row immutability alone would not give that.
   */
  let served = new Map<string, number>();
  let generation = 0;
  let controller: AbortController | null = null;
  const cancel = () => { generation++; controller?.abort(); controller = null; };
  onDestroy(cancel);

  // A new identity, or a new loader read for the same identity, supersedes whatever this section holds.
  $effect(() => {
    const key = `${appId}:${taskId}`;
    const source = initial;
    untrack(() => begin(key, source));
  });

  function begin(key: string, source: Promise<FindingsRead> | FindingsRead) {
    cancel();
    const mine = generation;
    view = { kind: 'loading' }; history = []; pending = false; failure = null; served = new Map();
    Promise.resolve(source).then(
      (read) => { if (mine === generation && key === `${appId}:${taskId}`) accept(read, { offset: 0, history: [] }, null); },
      () => { if (mine === generation) accept({ kind: 'failed' }, { offset: 0, history: [] }, null); },
    );
  }

  /** What a read means for the section. A page that is not the one asked for, or cannot advance, is a failure. */
  function checked(read: FindingsRead, req: Request): FindingsRead {
    if (!read || typeof read !== 'object') return { kind: 'failed' };
    if (read.kind === 'no-result' || read.kind === 'unavailable') return read;
    if (read.kind !== 'page') return { kind: 'failed' };
    const page = read.page;
    const valid = page && typeof page === 'object' && page.taskId === taskId && page.offset === req.offset ? parseFindingsPage(page) : null;
    if (!valid) return { kind: 'failed' };
    // A row already served at another absolute position means the provider is not advancing (adjacent or not): never "done", never a loop.
    // Re-reading the same rows at the same positions (Retry, First, Previous) is legitimate and passes.
    if (valid.items.some((row, i) => served.has(row.id) && served.get(row.id) !== req.offset + i)) return { kind: 'failed' };
    return { kind: 'page', page: { taskId, offset: req.offset, ...valid } };
  }

  async function accept(raw: FindingsRead, req: Request, trigger: HTMLButtonElement | null, ownedFocus = false) {
    const read = checked(raw, req);
    if (read.kind === 'page') {
      view = { kind: 'page', page: read.page }; history = req.history; failure = null;
      read.page.items.forEach((row, i) => served.set(row.id, req.offset + i));
    } else if (read.kind === 'failed') {
      // Keep a page that was already read only as retained data beside the failure; an initial failure has none.
      if (view.kind !== 'page') view = { kind: 'failed' };
      failure = req;
    } else {
      // no-result / unavailable clear the rows: nothing stale may stay readable.
      view = { kind: read.kind }; history = []; failure = null; served = new Map();
    }
    if (ownedFocus && trigger) {
      await tick();
      // The control that held focus is gone or disabled (the final page): focus the section instead of dropping to <body>.
      const lost = !trigger.isConnected || trigger.disabled;
      if (lost && (document.activeElement === trigger || document.activeElement === document.body || !document.activeElement)) heading?.focus();
    }
  }

  async function load(req: Request, trigger: HTMLButtonElement | null) {
    if (pending) return;
    const ownedFocus = !!trigger && document.activeElement === trigger;
    cancel();
    const mine = generation;
    const ctl = (controller = new AbortController());
    const issuedApp = appId; const issuedTask = taskId;
    pending = true;
    let read: FindingsRead;
    try {
      const response = await fetch(`/app/apps/${encodeURIComponent(issuedApp)}/tasks/${encodeURIComponent(issuedTask)}/findings?offset=${req.offset}`, { signal: ctl.signal, headers: { accept: 'application/json' } });
      if (response.status === 403 || response.status === 404) read = { kind: 'unavailable' };
      else if (!response.ok) read = { kind: 'failed' };
      else read = (await response.json()) as FindingsRead;
    } catch { read = { kind: 'failed' }; }
    // Identity and generation fence: a superseded answer is dropped before any state is written.
    // The generation half carries every reachable case: a prop change runs begin() (and its bump) synchronously
    // in the same flush, ahead of any queued continuation. The identity half is defense in depth (portal#2111).
    if (mine !== generation || issuedApp !== appId || issuedTask !== taskId) return;
    pending = false;
    await accept(read, req, trigger, ownedFocus);
  }

  const shown = $derived(view.kind === 'page' ? view.page : null);
  const rows = $derived<Finding[]>(shown ? shown.items : []);
  const range = $derived(shown && shown.items.length ? { from: shown.offset + 1, to: shown.offset + shown.items.length } : null);
  const canFirst = $derived(!!shown && shown.offset > 0);
  const canPrevious = $derived(history.length > 0);
  const canNext = $derived(!!shown && shown.hasMore);

  const first = (e: MouseEvent) => load({ offset: 0, history: [] }, e.currentTarget as HTMLButtonElement);
  const previous = (e: MouseEvent) => load({ offset: history[history.length - 1], history: history.slice(0, -1) }, e.currentTarget as HTMLButtonElement);
  const next = (e: MouseEvent) => shown && load({ offset: nextFindingsOffset(shown), history: [...history, shown.offset] }, e.currentTarget as HTMLButtonElement);
  const retry = (e: MouseEvent) => failure && load(failure, e.currentTarget as HTMLButtonElement);

  const columns: PortalColumnDef<Finding>[] = [
    { accessorKey: 'id', header: t('app.tasks.findings.col.id', 'ID'), size: 90, enableSorting: false, enableGlobalFilter: false },
    { accessorKey: 'severity', header: t('app.tasks.findings.col.severity', 'Severity'), size: 110, enableSorting: false, enableGlobalFilter: false },
    // Text is the finding: a saved arrangement may reorder or resize it but can never hide it.
    { accessorKey: 'text', header: t('app.tasks.findings.col.text', 'Text'), size: 520, enableSorting: false, enableGlobalFilter: false, enableHiding: false },
  ];
  const table = createSvelteTable<Finding>({
    get data() { return rows; },
    columns,
    getRowId: (row) => row.id,
    // The server pages; the grid shows exactly the rows it was served, in the order it served them.
    manualPagination: true,
    manualFiltering: true,
    initialState: { pagination: { pageIndex: 0, pageSize: FINDINGS_PROVIDER_MAX } },
  });

  const failedPage = t('app.tasks.findings.failed-page', 'Couldn’t load the page you asked for. These are the findings you were already reading.');

  /** Persistent live text: the range, the load, or the failure; never the findings' own text. */
  const status = $derived.by(() => {
    if (pending) return t('app.tasks.findings.loading', 'Loading findings…');
    // The same words the reader sees: a retained page has its own message (portal#2111).
    if (failure) return view.kind === 'page' ? failedPage : t('app.tasks.findings.failed', 'Couldn’t load findings. Try again.');
    if (view.kind === 'no-result') return t('app.tasks.findings.no-result', 'This task has no result, so it has no findings.');
    if (view.kind === 'unavailable') return t('app.tasks.findings.unavailable', 'These findings aren’t available.');
    if (view.kind === 'page') {
      if (range) return t('app.tasks.findings.range', 'Showing findings {from} to {to} of {total}', { from: range.from, to: range.to, total: view.page.total });
      return view.page.total === 0 ? t('app.tasks.findings.none', 'No recorded findings') : t('app.tasks.findings.past-end', 'No findings at this position; {total} recorded', { total: view.page.total });
    }
    return '';
  });

  const btn = 'rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 aria-disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800';
</script>

<section class="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900" aria-labelledby="findings-heading" aria-busy={pending} data-testid="task-findings">
  <h2 id="findings-heading" bind:this={heading} tabindex="-1" class="mb-2 text-sm font-semibold text-zinc-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-white">{t('app.tasks.findings', 'Findings')}</h2>
  <!-- Always mounted, so a screen reader that registered it hears every change. -->
  <div role="status" aria-live="polite" class="sr-only" data-testid="findings-status">{status}</div>

  <!-- Every provider-served value (id, severity, text) is shown literally, controls revealed, bidi isolated (portal#2111). -->
  {#snippet literal(value: string, testid: string, classes: string)}
    <div dir="auto" class="{classes} [unicode-bidi:isolate]" data-testid={testid}>{#each findingTextParts(value) as part, i (i)}{#if part.marker}<span class="mx-0.5 rounded bg-amber-100 px-1 font-mono text-xs text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">{part.text}</span>{:else}{part.text}{/if}{/each}</div>
  {/snippet}

  {#if view.kind === 'loading'}
    <p class="text-sm text-zinc-500 dark:text-zinc-400" data-testid="findings-loading">{t('app.tasks.findings.loading', 'Loading findings…')}</p>
  {:else if view.kind === 'no-result'}
    <p class="text-sm text-zinc-600 dark:text-zinc-300" data-testid="findings-no-result">{t('app.tasks.findings.no-result', 'This task has no result, so it has no findings.')}</p>
  {:else if view.kind === 'unavailable'}
    <p class="text-sm text-zinc-600 dark:text-zinc-300" data-testid="findings-unavailable">{t('app.tasks.findings.unavailable', 'These findings aren’t available.')}</p>
  {:else if view.kind === 'failed'}
    <p class="text-sm text-red-800 dark:text-red-300" data-testid="findings-failed">{t('app.tasks.findings.failed', 'Couldn’t load findings. Try again.')}</p>
    <button type="button" class="mt-2 {btn}" aria-disabled={pending} onclick={(e) => { if (!pending) retry(e); }}>{t('app.tasks.findings.retry', 'Retry')}</button>
  {:else}
    {#if failure}
      <p class="mb-2 text-sm text-red-800 dark:text-red-300" data-testid="findings-failed">
        {failedPage}
        <button type="button" class="ml-2 {btn}" aria-disabled={pending} onclick={(e) => { if (!pending) retry(e); }}>{t('app.tasks.findings.retry', 'Retry')}</button>
      </p>
    {/if}
    {#if view.page.items.length === 0}
      <p class="mb-2 text-sm text-zinc-600 dark:text-zinc-300" data-testid="findings-empty">{view.page.total === 0 ? t('app.tasks.findings.none', 'No recorded findings') : t('app.tasks.findings.past-end', 'No findings at this position; {total} recorded', { total: view.page.total })}</p>
    {/if}
    <DataTable {table} listKey="tasks:immutable-findings" showSearch={false} showFooter={false} searchPlaceholder={t('app.tasks.findings', 'Findings')} searchAriaLabel={t('app.tasks.findings', 'Findings')} maxHeight="32rem">
      {#snippet cell(c, row)}
        {#if c.column.id === 'text'}
          {@render literal(row.text, 'finding-text', 'select-text whitespace-pre-wrap break-words text-zinc-800 dark:text-zinc-200')}
        {:else if c.column.id === 'severity'}
          {@render literal(row.severity, 'finding-severity', '[overflow-wrap:anywhere] font-mono')}
        {:else}
          {@render literal(row.id, 'finding-id', 'break-all font-mono')}
        {/if}
      {/snippet}
    </DataTable>
    <div class="mt-3 flex flex-wrap items-center justify-between gap-3">
      <span class="text-sm text-zinc-500 dark:text-zinc-400" data-testid="findings-range">
        {#if range}{t('app.tasks.findings.range', 'Showing findings {from} to {to} of {total}', { from: range.from, to: range.to, total: view.page.total })}{:else}{t('app.tasks.findings.total', '{total} recorded', { total: view.page.total })}{/if}
      </span>
      <div class="flex flex-wrap items-center gap-2">
        <button type="button" class={btn} disabled={!canFirst} aria-disabled={pending} onclick={(e) => { if (!pending) first(e); }}>{t('app.tasks.findings.first', 'First')}</button>
        <button type="button" class={btn} disabled={!canPrevious} aria-disabled={pending} onclick={(e) => { if (!pending) previous(e); }}>{t('app.tasks.findings.previous', 'Previous')}</button>
        <button type="button" class={btn} disabled={!canNext} aria-disabled={pending} onclick={(e) => { if (!pending) next(e); }}>{t('app.tasks.findings.next', 'Next')}</button>
      </div>
    </div>
  {/if}
</section>
