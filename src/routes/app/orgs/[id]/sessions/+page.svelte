<script lang="ts">
  // #323: relocated from /app/usage/sessions. Same chrome conventions as the
  // other org grids — @tanstack/table-core + the Svelte 5 runes adapter
  // (src/lib/table/*), shared chrome in DataTable.svelte. listKey is kept as
  // 'usage:sessions' so users' saved views carry over from the old route.
  import type { PortalColumnDef } from '$lib/table/features';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import { makeGlobalFilterFn } from '$lib/table/global-filter';
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
  // time. See hadron-server hrn:node:hadronmemory.com:hadron-server:conventions:datetime-scalar-for-date-fields.
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

  // hadron-server#980 / hrn:node:hadronmemory.com:specs:cor:agt:020:02: this list is org-wide, so a worker is
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
    // a RENAMED id — hrn:node:hadronmemory.com:hadron-portal:review:saved-view-arrangement-not-position).
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
    // #820 — `startedAt` accessors epoch millis, `duration` elapsed millis and
    // `tokens` a sum rendered with separators, so 'includesString' searched
    // none of what the reader sees. `fmt` is the same map the cell falls back
    // to; the extra carries the wire ISO the date accessor discarded.
    globalFilterFn: makeGlobalFilterFn<Session>(fmt, {
      startedAt: (row) => row.startedAt,
    }),
    initialState: { pagination: { pageIndex: 0, pageSize: 20 } },
  });
</script>

<svelte:head><title>{t('sessions.title', 'Sessions')} · {org.name} · Hadron</title></svelte:head>

<div class="space-y-4">
  <!-- #734 / hadron-server#1034 — the vocabulary sweep deliberately does NOT
       rename this page.

       `sessions` returns EVERY session recorded against the caller, and the
       query's own note says `worker` is null "for a session that was never
       worker-bound (a plain user-driven session) — the COMMON case". So
       "Worker sessions" would be a heading that claims a filter this page does
       not apply, and would mislabel the majority of its own rows.

       The ratified vocabulary names two things — a WORKER session (the binding)
       and a CHAT session (the human's conversation) — and this list is the
       superset of the first, which has no ratified name. Rather than mint one,
       the copy DESCRIBES what a row is and says plainly what this page is not,
       which is the actual risk: a reader assuming these are their own chat
       sessions. Raised with the coordinator as a gap in #1034. -->
  <h1 class="text-lg font-semibold text-zinc-900 dark:text-white">{t('sessions.title', 'Sessions')}</h1>
  <p class="text-sm text-zinc-500">
    <!-- No proportion claim here. An earlier draft said "most sessions are not
         worker-bound", which is a server-side generality this page cannot
         verify: the loader fetches an arbitrary user-scoped page and never
         computes the ratio, so for a worker-driven user the sentence would
         contradict the rows directly beneath it. Describing the COLUMN is
         true for every reader; describing the population is not. (Codex, #743
         — and the same class of unsupported claim I declined to make by
         renaming the page.) -->
    {t(
      'sessions.description',
      'Agent and coding sessions recorded in Hadron — tokens, turns, duration and errors. The Worker column names the worker a session was bound to, and is empty when the session was not worker-bound. These are not your chat sessions.',
    )}
  </p>

  {#if data.sessions.length === 0}
    <p class="text-sm text-zinc-500">{t('sessions.empty', 'No sessions found.')}</p>
  {:else}
    <DataTable
      {table}
      listKey="usage:sessions"
      searchPlaceholder={t('sessions.search.placeholder', 'Search sessions...')}
      searchAriaLabel={t('sessions.search.aria-label', 'Search sessions')}
      bind:globalFilter
    >
      {#snippet cell(cell, session)}
        {#if cell.column.id === 'worker'}
          {#if session.worker}
            <div class="flex items-center gap-1.5 truncate" title={String(cell.getValue() ?? '')}>
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
          {@const text = String((f ? f(cell.getValue()) : cell.getValue()) ?? '')}
          <div class="truncate" title={text}>{text}</div>
        {/if}
      {/snippet}
    </DataTable>
  {/if}
</div>
