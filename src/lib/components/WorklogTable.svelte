<script lang="ts" module>
  import { artifactTitle as titleOf, isWorkerAttributed as attributed } from './worklog';
  import { t as tt } from '$lib/i18n/t';
  import type { ColumnSearchExtras } from '$lib/table/global-filter';
  import type { TeamWorkItem as Item } from '$lib/types';

  /**
   * Text the CELL renders that the accessors never see (@codex on #819).
   *
   * Exported so a test can drive the REAL filter rather than assert a regex over
   * this file — a source assertion passes on a component that no longer finds
   * the row.
   */
  /**
   * Built from the per-ref session counts, because one of the cell's strings
   * ("3 worker sessions") is derived from the WHOLE page rather than the row.
   *
   * Swept rather than patched: this is the fourth review round on the same
   * class, so every string the cell snippet renders beyond its accessor is
   * enumerated here — the artifact title and the fan-out label were BOTH
   * missing, and only the first was reported.
   */
  export function worklogSearchExtras(
    // A GETTER, not the map. `sessionCounts` is `$derived` from `items`, and the
    // filter is handed to createSvelteTable once — so capturing the value would
    // pin the fan-out labels to the first page of rows and never update. Svelte
    // flagged it (`state_referenced_locally`), which is the compiler catching
    // the class `hrn:node:hadronmemory.com:hadron-portal:review:preserve-getters-when-wrapping-options` describes.
    counts: () => Map<string, number>,
  ): ColumnSearchExtras<Item> {
    return {
      // The wire timestamp: `at`'s accessor returns epoch millis for sorting, so
      // `getValue` never sees the ISO string a reader pastes.
      at: (r) => r.at,
      // The "no worker" badge is the only marker of the one category it exists
      // to mark, and it lives in the cell rather than in the accessor.
      workerName: (r) => (attributed(r) ? null : tt('app.worklog.no-worker', 'no worker')),
      // A record with no model shows "Not recorded", and search finds it by that.
      model: (r) => (r.model ? null : tt('app.worklog.model.none', 'Not recorded')),
      // The Artifact cell renders TWO things the `ref` accessor does not: the
      // title, which is usually the most recognisable description of a record,
      // and the fan-out label, which is the answer the worklog exists to give.
      ref: (r) => {
        const shared = counts().get(r.ref) ?? 1;
        return [
          titleOf(r),
          shared > 1 ? `${shared} ${tt('app.worklog.shared', 'worker sessions')}` : null,
        ]
          .filter(Boolean)
          .join(' ') || null;
      },
    };
  }
</script>

<script lang="ts">
  import type { PortalColumnDef } from '$lib/table/features';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import DataTable from '$lib/components/table/DataTable.svelte';
  import { makeGlobalFilterFn, searchableText } from '$lib/table/global-filter';
  import { t } from '$lib/i18n/t';
  import {
    WORK_ITEM_KINDS,
    actionClass,
    artifactHref,
    artifactTitle,
    isWorkerAttributed,
    sessionsPerRef,
  } from './worklog';
  import type { TeamWorkItem } from '$lib/types';

  /**
   * The App's WORKLOG (hadron-portal#733) — the authoritative artifact-to-worker-
   * session join. This is the payoff for the whole attribution chain: cast a
   * worker, bind a worker session, log milestones, and a merged PR traces back
   * to the transcript that produced it.
   *
   * Append-only by contract, so there is deliberately no delete, no edit and no
   * rename here. A wrong record is corrected by recording a newer one.
   *
   * Renders through the shared `DataTable` rather than a hand-rolled `<table>`
   * (`hrn:node:hadronmemory.com:hadron-portal:findings:table-chrome-conventions`).
   * The three #733 rules survive the conversion unchanged, and they are the
   * reason this stays ONE component used by two pages: render the denormalized
   * `workerName` rather than joining, never dedupe the per-ref fan-out, and list
   * a record whose session is unreadable by id rather than dropping it.
   */
  let {
    items = [],
    total = 0,
    loadError = false,
    filters = { ref: '', kind: '', tool: '' },
    showFilters = true,
    listKey,
    maxHeight = 'max(200px, calc(100vh - 30rem))',
  }: {
    items?: TeamWorkItem[];
    /** The SERVER's count for the current filter, which may exceed what was fetched. */
    total?: number;
    loadError?: boolean;
    filters?: { ref: string; kind: string; tool: string };
    /**
     * #737 — off on the worker page, where the WORKER is already the filter and
     * the form's hidden `tab` field belongs to the App page's tab strip.
     */
    showFilters?: boolean;
    /**
     * Saved-view key, REQUIRED and distinct per surface. Two lists sharing one
     * key silently share arrangement
     * (`hrn:node:hadronmemory.com:hadron-portal:review:saved-view-arrangement-not-position`),
     * and this component renders on both the App and the Worker page — where a
     * reader wants different columns, since one is already filtered to a single
     * worker and the other is not.
     */
    listKey: string;
    maxHeight?: string;
  } = $props();

  const truncated = $derived(total > items.length);
  const hasFilters = $derived(!!(filters.ref || filters.kind || filters.tool));
  // Labels the fan-out; never collapses it. Several rows per ref is the answer
  // the worklog is asked for, not duplication to clean up.
  const sessionCounts = $derived(sessionsPerRef(items));

  // Tool suggestions, NOT the allowed values — the control is a free-text input
  // backed by a datalist for exactly that reason (Codex P2 + Copilot on #739).
  //
  // Two failures came from deriving *options* from the fetched page. A tool
  // that appears only in records older than the page cap could never be picked,
  // even though the server-side filter supports it. And once a tool filter
  // returned no rows, the option vanished with them — so the control fell back
  // to displaying "Any" while that filter was still applied, which is the UI
  // stating the opposite of what it is doing.
  //
  // The selected tool is unioned in regardless, so a filter that matches
  // nothing still shows itself.
  const toolSuggestions = $derived(
    [...new Set([...items.map((i) => i.tool), ...(filters.tool ? [filters.tool] : [])])].sort(),
  );

  /**
   * Epoch millis so "When" sorts by INSTANT rather than by the wire string —
   * `hrn:node:hadronmemory.com:hadron-portal:review:date-column-sorts-by-instant`.
   */
  function atMs(at: string): number | null {
    const ms = new Date(at).getTime();
    return Number.isNaN(ms) ? null : ms;
  }

  function formatAt(ms: number | null, raw: string): string {
    // Falls back to the raw value rather than an em dash: an unparseable
    // timestamp is still the only record of when this happened.
    return ms == null ? raw : new Date(ms).toLocaleString();
  }

  // `t()` resolves once, so a plain const — a rebuilt column set would reset
  // sort/visibility/page state on every render.
  const columns: PortalColumnDef<TeamWorkItem>[] = [
    {
      accessorFn: (r) => atMs(r.at),
      id: 'at',
      header: t('app.worklog.col.when', 'When'),
      enableHiding: false,
      size: 190,
    },
    {
      accessorKey: 'workerName',
      id: 'workerName',
      header: t('app.worklog.col.worker', 'Worker'),
      size: 180,
    },
    { accessorKey: 'action', id: 'action', header: t('app.worklog.col.action', 'Action'), size: 130 },
    { accessorKey: 'kind', id: 'kind', header: t('app.worklog.col.kind', 'Kind'), size: 110 },
    {
      // The ref is the equality-lookup key and what a reader searches for, so it
      // is its own sortable column rather than buried in a composite cell.
      accessorKey: 'ref',
      id: 'ref',
      header: t('app.worklog.col.artifact', 'Artifact'),
      size: 320,
    },
    { accessorKey: 'tool', id: 'tool', header: t('app.worklog.col.tool', 'Tool'), size: 120 },
    {
      // The LLM model that did the work (hadron-server#1398). Distinct from
      // Tool, which is where the ARTIFACT lives (github …). The value is the
      // record's own snapshot: never inferred from the worker, its role agent
      // or the provider.
      accessorFn: (r) => r.model ?? '',
      id: 'model',
      header: t('app.worklog.col.model', 'Model'),
      size: 200,
    },
    {
      accessorKey: 'sessionId',
      id: 'sessionId',
      header: t('app.worklog.col.session', 'Worker session'),
      size: 260,
    },
  ];

  /**
   * Per-column rendering, shared by the cell fallback and the search box.
   *
   * `at` is the one that matters: its accessor is epoch millis so the column
   * sorts by instant, which made the displayed date unsearchable until the
   * filter learned to compare the rendered form too (@codex).
   */
  const fmt: Record<string, (value: unknown) => string> = {
    at: (v) => (typeof v === 'number' ? new Date(v).toLocaleString() : ''),
  };

  function fallback(columnId: string, value: unknown): string {
    const text = searchableText(fmt, columnId, value);
    return text === '' ? '—' : text;
  }

  let globalFilter = $state('');

  const table = createSvelteTable<TeamWorkItem>({
    get data() {
      return items;
    },
    columns,
    enableMultiSort: false,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    state: {
      get globalFilter() {
        return globalFilter;
      },
    },
    onGlobalFilterChange: (u) => {
      globalFilter = typeof u === 'function' ? u(globalFilter) : u;
    },
    // See WorkerSessionsTable: 'includesString' compares the accessor, and
    // `at` accessors epoch millis so the column sorts by instant.
    // The wire timestamp too (@codex): `at`'s accessor returns epoch millis for
    // sorting, so `getValue` never sees the ISO string a reader pastes.
    globalFilterFn: makeGlobalFilterFn<TeamWorkItem>(fmt, worklogSearchExtras(() => sessionCounts)),
    initialState: {
      pagination: { pageIndex: 0, pageSize: 20 },
      sorting: [{ id: 'at', desc: true }],
    },
  });
</script>

<div class="space-y-4">
  <!-- Filters submit as a plain GET form: the resulting URL IS the shareable
       answer to "which worker sessions produced this PR?", which is the whole
       point of ref lookup. Server-side, because teamWorkItems normalizes a ref
       tool-awarely — a pasted PR URL and the short form find the same records,
       which a client-side compare could not do.

       Deliberately NOT folded into the grid's own search box: that filters the
       fetched page, this asks the server. Collapsing them would silently narrow
       "find every session that touched this PR" to "…among the rows already on
       screen". -->
  {#if showFilters}
    <form method="GET" class="flex flex-wrap items-end gap-3">
      <input type="hidden" name="tab" value="worklog" />
      <div class="min-w-64 flex-1">
        <label for="worklog-ref" class="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
          {t('app.worklog.filter.ref', 'Artifact')}
        </label>
        <input
          id="worklog-ref"
          name="worklogRef"
          value={filters.ref}
          placeholder={t('app.worklog.filter.ref.placeholder', 'owner/repo#123, a commit sha, or a pasted URL')}
          class="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500"
        />
      </div>
      <div>
        <label for="worklog-kind" class="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
          {t('app.worklog.filter.kind', 'Kind')}
        </label>
        <select
          id="worklog-kind"
          name="worklogKind"
          value={filters.kind}
          class="mt-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
        >
          <option value="">{t('app.worklog.filter.any', 'Any')}</option>
          {#each WORK_ITEM_KINDS as k (k)}
            <option value={k}>{k}</option>
          {/each}
        </select>
      </div>
      <div>
        <label for="worklog-tool" class="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
          {t('app.worklog.filter.tool', 'Tool')}
        </label>
        <input
          id="worklog-tool"
          name="worklogTool"
          value={filters.tool}
          list="worklog-tool-options"
          placeholder={t('app.worklog.filter.any', 'Any')}
          class="mt-1 w-36 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500"
        />
        <datalist id="worklog-tool-options">
          {#each toolSuggestions as tool (tool)}
            <option value={tool}></option>
          {/each}
        </datalist>
      </div>
      <button
        type="submit"
        class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 dark:bg-indigo-500 dark:hover:bg-indigo-600"
      >
        {t('app.worklog.filter.apply', 'Filter')}
      </button>
      {#if hasFilters}
        <a
          href="?tab=worklog"
          class="rounded-lg border border-zinc-300 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          {t('app.worklog.filter.clear', 'Clear')}
        </a>
      {/if}
    </form>
  {/if}

  {#if loadError}
    <!-- "Couldn't load" and "no records" are different statements. The empty
         state below is a claim about the team's work and must not be made on a
         network failure. The grid is not rendered at all here: there is no data
         to arrange, and a saved view cannot strand a reader on an error banner. -->
    <div role="alert" class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
      {t('app.worklog.load-error', 'Could not load the worklog. This is a loading failure, not an empty worklog — reload to try again.')}
    </div>
  {:else}
    {#if items.length === 0}
      <!-- A BANNER above a still-mounted grid, not a replacement for it
           (hrn:node:hadronmemory.com:hadron-portal:review:saved-view-arrangement-not-position).
           Unmounting the table takes ViewTabs with it, and ViewTabs' own mount
           re-applies the active saved view — so a view whose filter matches
           nothing would remove the only controls that could change it. -->
      <div class="rounded-lg border border-zinc-200 bg-zinc-50 px-6 py-6 text-center dark:border-zinc-800 dark:bg-zinc-950">
        <p class="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          {hasFilters
            ? t('app.worklog.empty.filtered.title', 'No work records match these filters')
            : t('app.worklog.empty.title', 'No work records yet')}
        </p>
        <p class="mt-1 text-sm text-zinc-500">
          {hasFilters
            ? t('app.worklog.empty.filtered.body', 'Try a different artifact, kind or tool — or clear the filters.')
            : t('app.worklog.empty.body', 'Workers record milestones here — a PR opened, a branch pushed, an issue closed — from their worker sessions.')}
        </p>
      </div>
    {:else}
      <p class="text-xs text-zinc-500 dark:text-zinc-400">
        {#if truncated}
          {t('app.worklog.count.truncated', 'Showing the most recent')}
          {items.length} {t('app.worklog.count.of', 'of')} {total}.
        {:else}
          {total}
          {total === 1
            ? t('app.worklog.count.one', 'record')
            : t('app.worklog.count.many', 'records')}.
        {/if}
      </p>
    {/if}

    <DataTable
      {table}
      {listKey}
      {maxHeight}
      bind:globalFilter
      searchPlaceholder={t('app.worklog.search', 'Search these records…')}
      searchAriaLabel={t('app.worklog.search.aria', 'Search the worklog records on this page')}
    >
      {#snippet cell(c, row)}
        {#if c.column.id === 'at'}
          <span class="block truncate text-zinc-500 dark:text-zinc-400">
            {formatAt(atMs(row.at), row.at)}
          </span>
        {:else if c.column.id === 'workerName'}
          <!-- workerName is denormalized at write, which is what makes it
               correct for a RETIRED worker and for pre-#974 records. Render it;
               never join through workerId to get a name. -->
          <span class="font-medium text-zinc-900 dark:text-white">{row.workerName}</span>
          {#if !isWorkerAttributed(row)}
            <!-- A null workerId means this record is not attributed to a Worker.
                 It does NOT say why, and the badge must not invent one: the
                 server writes `workerName` from the bound worker's name, ELSE
                 the attributed USER's handle for an unbound session, and
                 pre-#974 records carry a stored personaName there. -->
            <span
              class="ml-1 rounded border border-zinc-300 bg-zinc-100 px-1 py-0.5 text-[10px] uppercase text-zinc-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
              title={t(
                'app.worklog.no-worker.hint',
                'This record is not attributed to a worker. The name shown is whatever the record stored — an unbound session records the person’s handle, and records made before the worker model store a persona name.',
              )}
            >
              {t('app.worklog.no-worker', 'no worker')}
            </span>
          {/if}
        {:else if c.column.id === 'action'}
          <span class="rounded px-1.5 py-0.5 text-xs font-medium {actionClass(row.action)}">
            {row.action}
          </span>
        {:else if c.column.id === 'kind'}
          <span class="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] uppercase text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
            {row.kind}
          </span>
        {:else if c.column.id === 'ref'}
          {@const href = artifactHref(row)}
          {@const title = artifactTitle(row)}
          {@const shared = sessionCounts.get(row.ref) ?? 1}
          <div class="flex min-w-0 flex-wrap items-center gap-2">
            {#if href}
              <a
                {href}
                target="_blank"
                rel="noopener noreferrer"
                class="truncate font-mono text-xs text-indigo-600 hover:underline dark:text-indigo-300"
              >{row.ref}</a>
            {:else}
              <span class="truncate font-mono text-xs text-zinc-700 dark:text-zinc-200">{row.ref}</span>
            {/if}
            {#if shared > 1}
              <!-- Several worker sessions on one artifact is the FEATURE, not
                   duplication: it is the answer to "which sessions produced
                   this?". Label it so repeated rows read as information rather
                   than as a data problem. -->
              <a
                href="?tab=worklog&worklogRef={encodeURIComponent(row.ref)}"
                class="shrink-0 rounded bg-indigo-100 px-1.5 py-0.5 text-[11px] text-indigo-700 hover:underline dark:bg-indigo-950 dark:text-indigo-300"
                title={t('app.worklog.shared.hint', 'Several worker sessions recorded work on this artifact. Show them all.')}
              >
                {shared} {t('app.worklog.shared', 'worker sessions')}
              </a>
            {/if}
          </div>
          {#if title}
            <div class="truncate text-xs text-zinc-500 dark:text-zinc-400" {title}>{title}</div>
          {/if}
        {:else if c.column.id === 'model'}
          {#if row.model}
            <span class="block truncate font-mono text-xs text-zinc-700 dark:text-zinc-200" title={row.model}>{row.model}</span>
          {:else}
            <!-- Null is "unknown at record time": the record predates the
                 field, or nothing reported a model. Never the worker's current
                 model, which may not be the one that did this work. -->
            <span
              class="block truncate text-xs italic text-zinc-400"
              title={t('app.worklog.model.none.hint', 'No model was recorded with this entry. It predates model tracking, or its session reported none.')}
            >{t('app.worklog.model.none', 'Not recorded')}</span>
          {/if}
        {:else if c.column.id === 'sessionId'}
          <!-- The id is shown even when the worker session is not readable by
               this viewer: a record that exists must not vanish from the
               provenance chain just because its session is out of reach. The
               CLI's provenance query behaves this way and the portal must not
               be lossier. -->
          <span class="block truncate font-mono text-xs text-zinc-500 dark:text-zinc-400">{row.sessionId}</span>
        {:else}
          <span class="block truncate">{fallback(c.column.id, c.getValue())}</span>
        {/if}
      {/snippet}
    </DataTable>
  {/if}
</div>
