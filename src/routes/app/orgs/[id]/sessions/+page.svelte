<script lang="ts">
  // #323: relocated from /app/usage/sessions. Same chrome conventions as the
  // other org grids — @tanstack/table-core + the Svelte 5 runes adapter
  // (src/lib/table/*), shared chrome in DataTable.svelte. listKey is kept as
  // 'usage:sessions' so users' saved views carry over from the old route.
  import {
    getCoreRowModel,
    getSortedRowModel,
    getFilteredRowModel,
    getPaginationRowModel,
    type ColumnDef,
  } from '@tanstack/table-core';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import DataTable from '$lib/components/table/DataTable.svelte';
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

  interface Session {
    id: string; type: string; appId: string | null; repo: string | null; branch: string | null;
    llmModel: string | null; summary: string | null; inputTokens: number | null; outputTokens: number | null;
    turnCount: number | null; errorCount: number | null; startedAt: string; endedAt: string | null;
  }

  let globalFilter = $state('');

  const columns: ColumnDef<Session>[] = [
    { accessorFn: (row) => dateMs(row.startedAt), id: 'started', header: t('sessions.column.started', 'Started'), enableHiding: false, size: 110 }, // identity column
    { accessorKey: 'type', header: t('sessions.column.type', 'Type'), size: 90 },
    {
      accessorFn: (row) => row.summary ?? (row.repo ? `${row.repo}${row.branch ? ` (${row.branch})` : ''}` : '—'),
      id: 'summary',
      header: t('sessions.column.summary', 'Summary'),
      size: 320,
    },
    { accessorKey: 'llmModel', header: t('sessions.column.model', 'Model'), size: 150 },
    { accessorFn: (row) => durationMs(row.startedAt, row.endedAt), id: 'duration', header: t('sessions.column.duration', 'Duration'), size: 90 },
    { accessorKey: 'turnCount', header: t('sessions.column.turns', 'Turns'), size: 70 },
    { accessorFn: (row) => (row.inputTokens ?? 0) + (row.outputTokens ?? 0), id: 'tokens', header: t('sessions.column.tokens', 'Tokens'), size: 100 },
    { accessorKey: 'errorCount', header: t('sessions.column.errors', 'Errors'), size: 80 },
  ];

  const fmt: Record<string, (v: unknown) => string> = {
    started: (v) => formatDate(v as number | null),
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
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
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
      {#snippet cell(cell)}
        {@const f = fmt[cell.column.id]}
        <div class="truncate">{f ? f(cell.getValue()) : cell.getValue()}</div>
      {/snippet}
    </DataTable>
  {/if}
</div>
