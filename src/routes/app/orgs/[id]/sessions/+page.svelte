<script lang="ts">
  // #323: relocated from /app/usage/sessions. Same chrome conventions as the
  // other org grids — @tanstack/table-core + the Svelte 5 runes adapter
  // (src/lib/table/*), shared chrome in DataTable.svelte. listKey is kept as
  // 'usage:sessions' so users' saved views carry over from the old route.
  import type { PortalColumnDef } from '$lib/table/features';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import DataTable from '$lib/components/table/DataTable.svelte';
  import WorkerBadge from '$lib/components/WorkerBadge.svelte';
  import { orgWideWorkerLabel } from '$lib/workers/worker-label';
  import { t } from '$lib/i18n/t';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  const org = $derived(data.org);

  // Epoch milliseconds (or null when absent/unparseable) so date columns sort by
  // instant rather than by the raw wire string. The `DateTime` scalar only
  // guarantees a `Date.parse`-able value — NOT byte-for-byte ISO UTC — so a
  // pass-through value carrying a non-UTC offset makes lexicographic string
  // order differ from chronological order. Formatting happens in `fmt` at render
  // time. See hadron-server conventions:datetime-scalar-for-date-fields.
  function dateMs(val: string | null): number | null {
    if (!val) return null;
    const ms = new Date(val).getTime();
    return isNaN(ms) ? null : ms;
  }

  function formatDate(ms: number | null): string {
    if (ms == null) return '—';
    return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // Raw elapsed milliseconds (or null) so the Duration column sorts numerically;
  // formatting happens in `fmt.duration` at render time.
  function durationMs(start: string | null, end: string | null): number | null {
    if (!start || !end) return null;
    const s = new Date(start).getTime();
    const e = new Date(end).getTime();
    if (isNaN(s) || isNaN(e) || e - s < 0) return null;
    return e - s;
  }

  function formatDuration(ms: number | null): string {
    if (ms == null) return '—';
    if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
    if (ms < 3600_000) return `${Math.round(ms / 60_000)}m`;
    return `${(ms / 3600_000).toFixed(1)}h`;
  }

  interface SessionWorker {
    id: string;
    name: string;
    retiredAt: string | null;
    app: { id: string; urn: string } | null;
  }

  interface Session {
    id: string; type: string; appId: string | null; repo: string | null; branch: string | null;
    llmModel: string | null; summary: string | null; inputTokens: number | null; outputTokens: number | null;
    turnCount: number | null; errorCount: number | null; startedAt: string; endedAt: string | null;
    worker: SessionWorker | null;
  }

  // hadron-server#980 / cor:agt:020:02: this list is org-wide, so a worker is
  // rendered app-qualified ("eng-team/Iris"). A bare name would be ambiguous —
  // another App may have its own Iris, and a human org member may be called
  // Iris too (which is what WorkerBadge disambiguates).
  //
  // The label is computed in the ACCESSOR, not just the cell, so sorting and
  // the global filter operate on the string the user actually sees — searching
  // "eng-team" finds that App's sessions.

  let globalFilter = $state('');

  const columns: PortalColumnDef<Session>[] = [
    // id stays 'startedAt' (the pre-accessorFn accessorKey): saved views for
    // listKey "usage:sessions" store sorting/visibility/order/sizing BY COLUMN
    // ID, and applyView silently drops ids that no longer exist — so renaming
    // the column would quietly discard that state in every existing view.
    { accessorFn: (row) => dateMs(row.startedAt), id: 'startedAt', header: t('sessions.column.started', 'Started'), enableHiding: false, size: 110 }, // identity column
    { accessorKey: 'type', header: t('sessions.column.type', 'Type'), size: 90 },
    {
      accessorFn: (row) => row.summary ?? (row.repo ? `${row.repo}${row.branch ? ` (${row.branch})` : ''}` : '—'),
      id: 'summary',
      header: t('sessions.column.summary', 'Summary'),
      size: 320,
    },
    // New column id — existing saved views for listKey "usage:sessions" simply
    // don't mention it, so it renders visible and TanStack appends it to a
    // persisted columnOrder. No saved state is discarded (that only happens on
    // a RENAMED id — review:saved-view-arrangement-not-position).
    { accessorFn: (row) => orgWideWorkerLabel(row.worker), id: 'worker', header: t('sessions.column.worker', 'Worker'), size: 170 },
    { accessorKey: 'llmModel', header: t('sessions.column.model', 'Model'), size: 150 },
    { accessorFn: (row) => durationMs(row.startedAt, row.endedAt), id: 'duration', header: t('sessions.column.duration', 'Duration'), size: 90 },
    { accessorKey: 'turnCount', header: t('sessions.column.turns', 'Turns'), size: 70 },
    { accessorFn: (row) => (row.inputTokens ?? 0) + (row.outputTokens ?? 0), id: 'tokens', header: t('sessions.column.tokens', 'Tokens'), size: 100 },
    { accessorKey: 'errorCount', header: t('sessions.column.errors', 'Errors'), size: 80 },
  ];

  const fmt: Record<string, (v: unknown) => string> = {
    startedAt: (v) => formatDate(v as number | null),
    llmModel: (v) => (v as string | null) ?? '—',
    duration: (v) => formatDuration(v as number | null),
    turnCount: (v) => (v == null ? '—' : String(v)),
    tokens: (v) => ((v as number) > 0 ? (v as number).toLocaleString() : '—'),
    errorCount: (v) => (v == null ? '—' : String(v)),
  };

  const table = createSvelteTable<Session>({
    get data() {
      return data.sessions as Session[];
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
    globalFilterFn: 'includesString',
    initialState: { pagination: { pageIndex: 0, pageSize: 20 } },
  });
</script>

<svelte:head><title>Sessions · {org.name} · Hadron</title></svelte:head>

<div class="space-y-4">
  <h1 class="text-lg font-semibold text-zinc-900 dark:text-white">Sessions</h1>
  <p class="text-sm text-zinc-500">Agent and coding-session activity — tokens, turns, duration, and errors.</p>

  {#if data.sessions.length === 0}
    <p class="text-sm text-zinc-500">No sessions found.</p>
  {:else}
    <DataTable
      {table}
      listKey="usage:sessions"
      searchPlaceholder={t('sessions.search.placeholder', 'Search sessions...')}
      searchAriaLabel={t('sessions.search.aria-label', 'Search sessions')}
      bind:globalFilter
      maxHeight="max(200px, calc(100vh - 23rem))"
    >
      {#snippet cell(cell, session)}
        {#if cell.column.id === 'worker'}
          {#if session.worker}
            <div class="flex items-center gap-1.5 truncate">
              <span class="truncate">{cell.getValue()}</span>
              <WorkerBadge retired={!!session.worker.retiredAt} size="xs" />
              {#if !session.worker.app}
                <!--
                  The name on this row is UNQUALIFIED (the App's own read gate
                  masked it), which on an org-wide surface is the one thing
                  cor:agt:020:02 says not to show silently. So the caveat is a
                  visible text chip, not a `title`: a title on a non-focusable
                  span is unreachable by keyboard and touch and is announced
                  inconsistently by assistive tech (Codex, PR #717). Same
                  text-not-colour-alone rule WorkerBadge follows; the sr-only
                  span carries the full sentence so the terse chip isn't the
                  only explanation a screen-reader user gets.
                -->
                <span
                  class="inline-flex shrink-0 items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                >
                  {t('sessions.worker.unqualified', 'app hidden')}
                  <span class="sr-only">
                    {' — '}{t(
                      'sessions.worker.app-hidden',
                      'The App behind this worker isn’t visible to you, so this name can’t be qualified and may be ambiguous.',
                    )}
                  </span>
                </span>
              {/if}
            </div>
          {:else}
            <!-- Not an error: a session with no worker was driven by a person,
                 not a casting. -->
            <div class="truncate text-zinc-400">—</div>
          {/if}
        {:else}
          {@const f = fmt[cell.column.id]}
          <div class="truncate">{f ? f(cell.getValue()) : cell.getValue()}</div>
        {/if}
      {/snippet}
    </DataTable>
  {/if}
</div>
