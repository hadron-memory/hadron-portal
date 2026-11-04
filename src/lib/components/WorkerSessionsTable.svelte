<!--
  The worker detail page's "Worker sessions" list, as a TanStack grid.

  Converted from a bespoke `<ul>` whose every row stacked eleven fields into
  three lines of prose. Per CLAUDE.md every list is a `DataTable`
  (`hrn:node:hadronmemory.com:hadron-portal:findings:table-chrome-conventions`),
  and the conversion is the point rather than a refactor: the old markup could
  not be sorted, searched, or reduced to the columns a reader cared about, and
  every field it carried was rendered on every row whether or not it had a value.

  What the grid adds that the list structurally could not: sort by start or end
  instant, search across every field, hide the columns this reader does not use,
  and page through rather than scroll one long ribbon.

  The caller-scoped caveat, the unavailable-vs-empty distinction and the
  truncation note all stay on the PAGE — they are statements about the READ,
  not about a row, and folding them into the grid would lose that.
-->
<script lang="ts" module>
  import { expiryDistance as expiryDistanceFor, workerSessionStatus as statusFor } from '$lib/worker-session-status';
  import { t as tt } from '$lib/i18n/t';
  import type { ColumnSearchExtras } from '$lib/table/global-filter';
  import type { WorkerSession as Session } from '$lib/types';

  /**
   * The forward-looking expiry line, or null when there is nothing to warn about.
   *
   * Exported from the module script so the searchable extras below are the SAME
   * function the cell renders, and so a test can exercise the real filter rather
   * than a regex over this file. A source assertion would pass on a component
   * that no longer finds the row.
   */
  export function expiryLabelFor(session: Session, now: number): string | null {
    const status = statusFor(session, now);
    if (!status.expiringSoon || status.msUntilExpiry === null) return null;
    if (status.msUntilExpiry < 0) {
      return tt('worker.sessions.overdue', 'Past its expiry — live only until the next reap');
    }
    const d = expiryDistanceFor(status.msUntilExpiry);
    // The WHOLE sentence goes through t(), one key per unit, with only the
    // number interpolated. Translating "Expires" and concatenating a formatted
    // "in 45 min" would leave an English fragment past the i18n boundary and fix
    // the word order in English (Codex P2 on the original list).
    return d.unit === 'min'
      ? tt('worker.sessions.expiring.minutes', 'Expires in {n} min', { n: d.value })
      : tt('worker.sessions.expiring.hours', 'Expires in {n} h', { n: d.value });
  }

  /**
   * Text the CELL renders that the accessors never see, so the search box can
   * find a row by what is on screen (@codex on #819).
   */
  export function sessionSearchExtras(now: number): ColumnSearchExtras<Session> {
    return {
      // The wire timestamps: the date accessors return epoch millis for sorting,
      // so `getValue` never sees the ISO string a reader pastes from a log.
      startedAt: (s) => s.startedAt,
      endedAt: (s) => s.endedAt,
      // The expiry warning sits beside the status word in the cell, and it is
      // the most operationally urgent text on the row.
      status: (s) => expiryLabelFor(s, now),
    };
  }
</script>

<script lang="ts">
  import type { PortalColumnDef } from '$lib/table/features';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import DataTable from '$lib/components/table/DataTable.svelte';
  import { makeGlobalFilterFn, searchableText } from '$lib/table/global-filter';
  import { t } from '$lib/i18n/t';
  import { workerSessionStatus } from '$lib/worker-session-status';
  import type { WorkerSession } from '$lib/types';

  let {
    sessions,
    /**
     * Saved-view key. A prop rather than a constant because two lists sharing
     * one key silently share arrangement
     * (`hrn:node:hadronmemory.com:hadron-portal:review:saved-view-arrangement-not-position`);
     * today there is one caller, and the next one must not inherit its columns.
     */
    listKey = 'workers:sessions',
    maxHeight = 'max(200px, calc(100vh - 30rem))',
    onServed = undefined,
    servedId = null,
  }: {
    sessions: WorkerSession[];
    listKey?: string;
    maxHeight?: string;
    /** portal#1665: open this session's served-prompt record. Omit to hide the column. */
    onServed?: (sessionId: string) => void;
    /** The session whose record is open, for aria-pressed. */
    servedId?: string | null;
  } = $props();

  // Captured once per render rather than per row, so every countdown on the
  // page is measured against the same instant. Deliberately not reactive: a
  // badge that silently ticks would imply a liveness we are not subscribed to.
  const now = Date.now();

  /**
   * Epoch millis (or null) so date columns sort by INSTANT, not by the raw wire
   * string — `hrn:node:hadronmemory.com:hadron-portal:review:date-column-sorts-by-instant`.
   * The `DateTime` scalar only promises a `Date.parse`-able value, so
   * lexicographic order and chronological order can differ.
   */
  function dateMs(value: string | null | undefined): number | null {
    if (!value) return null;
    const ms = new Date(value).getTime();
    return Number.isNaN(ms) ? null : ms;
  }

  function fmtDate(ms: number | null): string {
    return ms == null ? '—' : new Date(ms).toLocaleString();
  }

  /**
   * The status word, as rendered.
   *
   * The accessor returns the SAME string the badge shows so sorting and the
   * global filter match the screen — typing "expired" finds the expired rows.
   * EXPIRED stays its own state and is never folded into "Ended": the reaper
   * sets `endedAt` too, so collapsing them would tell a reader somebody chose
   * to stop when the session actually died under them.
   */
  function statusLabel(session: WorkerSession): string {
    const { state } = workerSessionStatus(session, now);
    if (state === 'open') return t('worker.sessions.state.open', 'Open');
    if (state === 'expired') return t('worker.sessions.state.expired', 'Expired — reaped by the server');
    return t('worker.sessions.state.ended', 'Ended');
  }

  /** Delegates to the module-scope function the search extras also use. */
  const expiryLabel = (session: WorkerSession) => expiryLabelFor(session, now);

  /** `repo@branch`, or just the repo, or nothing. */
  function repoLabel(session: WorkerSession): string {
    if (!session.repo) return '';
    return session.branch ? `${session.repo}@${session.branch}` : session.repo;
  }

  // `t()` resolves once, so a plain const — not `$derived`. A rebuilt column set
  // would reset the table's sort/visibility/page state on every render.
  const columns: PortalColumnDef<WorkerSession>[] = [
    {
      accessorFn: (s) => dateMs(s.startedAt),
      // Explicit id: a column id is a compatibility surface for saved views, and
      // an accessorFn without one would key view state on a generated name.
      id: 'startedAt',
      header: t('worker.sessions.col.started', 'Started'),
      enableHiding: false,
      size: 190,
    },
    {
      accessorFn: (s) => statusLabel(s),
      id: 'status',
      header: t('worker.sessions.col.status', 'Status'),
      size: 220,
    },
    {
      accessorFn: (s) => dateMs(s.endedAt),
      id: 'endedAt',
      header: t('worker.sessions.col.ended', 'Ended'),
      size: 190,
    },
    { accessorKey: 'plan', header: t('worker.sessions.col.plan', 'Plan'), size: 260 },
    { accessorKey: 'summary', header: t('worker.sessions.col.summary', 'Summary'), size: 260 },
    {
      accessorFn: (s) => repoLabel(s),
      id: 'repo',
      header: t('worker.sessions.col.repo', 'Repo'),
      size: 200,
    },
    { accessorKey: 'tool', header: t('worker.sessions.col.tool', 'Tool'), size: 120 },
    { accessorKey: 'host', header: t('worker.sessions.col.host', 'Host'), size: 140 },
    { accessorKey: 'llmModel', header: t('worker.sessions.col.model', 'Model'), size: 170 },
    {
      // Numeric accessor so PR numbers sort numerically rather than as text.
      accessorFn: (s) => s.prNumber,
      id: 'prNumber',
      header: t('worker.sessions.col.pr', 'PR'),
      size: 90,
    },
    {
      accessorKey: 'transcriptPath',
      header: t('worker.sessions.col.transcript', 'Transcript'),
      size: 240,
    },
    {
      // An action, not data: nothing to sort, search or hide-by-value (portal#1665).
      id: 'served',
      accessorFn: () => null,
      header: t('worker.sessions.col.served', 'Served prompt'),
      enableSorting: false,
      size: 150,
    },
  ];

  /** Defensive per-column formatters: null / blank renders as an em dash. */
  const fmt: Record<string, (value: unknown) => string> = {
    startedAt: (v) => fmtDate(typeof v === 'number' ? v : null),
    endedAt: (v) => fmtDate(typeof v === 'number' ? v : null),
    prNumber: (v) => (typeof v === 'number' ? `#${v}` : '—'),
  };

  // One definition of "rendered", shared by the cell and the search box. Two
  // copies is how a column becomes searchable by a string it no longer shows.
  function fallback(columnId: string, value: unknown): string {
    const text = searchableText(fmt, columnId, value);
    return text === '' ? '—' : text;
  }

  let globalFilter = $state('');

  const table = createSvelteTable<WorkerSession>({
    get data() {
      return sessions;
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
    // NOT 'includesString' (@codex): that stringifies the ACCESSOR, and the
    // date columns accessor epoch millis so they sort by instant. A reader
    // typing the date they can see — 9/6/2026 — matched nothing, because the
    // filter was comparing against 1757145600000.
    // The wire timestamps too (@codex): the date accessors return epoch millis
    // for sorting, so `getValue` never sees the ISO string a reader pastes from
    // an API response or a log line.
    globalFilterFn: makeGlobalFilterFn<WorkerSession>(fmt, sessionSearchExtras(now)),
    initialState: {
      pagination: { pageIndex: 0, pageSize: 20 },
      // Most recent first: the stint a reader is looking for is almost always
      // the last one they drove.
      sorting: [{ id: 'startedAt', desc: true }],
    },
  });
</script>

<DataTable
  {table}
  {listKey}
  {maxHeight}
  bind:globalFilter
  searchPlaceholder={t('worker.sessions.search', 'Search worker sessions…')}
  searchAriaLabel={t('worker.sessions.search.aria', 'Search worker sessions')}
>
  {#snippet cell(c, row)}
    {#if c.column.id === 'status'}
      {@const status = workerSessionStatus(row, now)}
      {@const expiry = expiryLabel(row)}
      <div class="flex flex-wrap items-center gap-1">
        {#if status.state === 'open'}
          <span class="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-950 dark:text-green-300"
            >{t('worker.sessions.state.open', 'Open')}</span
          >
        {:else if status.state === 'expired'}
          <span class="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300"
            >{t('worker.sessions.state.expired', 'Expired — reaped by the server')}</span
          >
        {:else}
          <span class="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
            >{t('worker.sessions.state.ended', 'Ended')}</span
          >
        {/if}
        {#if expiry}
          <!-- The only forward-looking expiry signal any client shows. Every
               expiry on this team so far was discovered by a write failing
               (hadron-cli#484). -->
          <span class="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-950 dark:text-red-300">
            {expiry}
          </span>
        {/if}
      </div>
    {:else if c.column.id === 'served'}
      {#if onServed}
        <button
          type="button"
          class="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          aria-pressed={servedId === row.id}
          aria-label={t('worker.sessions.served.aria', 'Served prompt for the session started {when}', { when: fmtDate(dateMs(row.startedAt)) })}
          onclick={() => onServed(row.id)}
        >
          {t('worker.sessions.served.show', 'Show')}
        </button>
      {:else}
        <span class="text-zinc-400">—</span>
      {/if}
    {:else if c.column.id === 'transcriptPath'}
      <!-- Host-local, and meaningless to anyone not on that machine — so plain
           text, never a link (#737). -->
      {#if row.transcriptPath}
        <span class="block truncate font-mono text-[11px] text-zinc-400" title={row.transcriptPath}>
          {row.transcriptPath}
        </span>
      {:else}
        <span class="text-zinc-400">—</span>
      {/if}
    {:else if c.column.id === 'plan' || c.column.id === 'summary'}
      {@const text = c.column.id === 'plan' ? row.plan : row.summary}
      {#if text}
        <span class="block truncate" title={text}>{text}</span>
      {:else}
        <span class="text-zinc-400">—</span>
      {/if}
    {:else}
      <span class="block truncate">{fallback(c.column.id, c.getValue())}</span>
    {/if}
  {/snippet}
</DataTable>
