<!--
  #919 — the workers a user HOLDS, on their profile page, as a TanStack grid.

  Holger's ruling: every held worker, with a live session marked "Active now"
  and the rest "Last recorded activity …". Holding is whose name a worker is; a live
  session is someone driving it right now. Both come from the server under its
  worker read gate, and the working-state fields are MASKED to null on deny,
  so a null here is "not shown to you", never "no".
-->
<script lang="ts" module>
  import { t as tt } from '$lib/i18n/t';
  import type { ColumnSearchExtras } from '$lib/table/global-filter';

  export interface HeldWorker {
    id: string;
    name: string;
    urn: string | null;
    role: string | null;
    appId: string;
    appUrn: string | null;
    heldAt: string | null;
    hasLiveSession: boolean | null;
    lastActiveAt: string | null;
  }

  export type HeldWorkerState = 'active' | 'idle' | 'never' | 'unknown';

  /**
   * - `active`: a live session (the server's idle-window predicate, not merely
   *   an unended Session row);
   * - `idle`: driven before, not now;
   * - `never`: nobody has ever bound it;
   * - `unknown`: masked by the read gate. Said as "Not shown to you", never
   *   as "idle" or "never driven".
   */
  export function heldWorkerState(w: HeldWorker): HeldWorkerState {
    if (w.hasLiveSession === true) return 'active';
    if (w.hasLiveSession === false) return w.lastActiveAt ? 'idle' : 'never';
    return 'unknown';
  }

  function fmtDate(value: string | null): string {
    if (!value) return '';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
  }

  /** The state as the cell renders it, and as the search box finds it. */
  export function heldWorkerStateLabel(w: HeldWorker): string {
    switch (heldWorkerState(w)) {
      case 'active':
        return tt('user.workers.state.active', 'Active now');
      case 'idle':
        return tt('user.workers.state.idle', 'Last recorded activity {when}', { when: fmtDate(w.lastActiveAt) });
      case 'never':
        return tt('user.workers.state.never', 'No recorded activity');
      default:
        // Said in words, not a dash with a hover-only title: keyboard and
        // touch users must be able to tell MASKED from missing (@codex on #930).
        return tt('user.workers.state.unknown', 'Not shown to you');
    }
  }

  /** The role cell's text: the role, or the "No role" it renders instead. */
  export function heldWorkerRoleLabel(w: HeldWorker): string {
    return w.role || tt('user.workers.no-role', 'No role');
  }

  /**
   * Text the cells render that the accessors do not carry, so the search box
   * finds a row by what is on screen (@codex on #930: "No role" was shown and
   * unsearchable).
   */
  export const heldWorkerSearchExtras: ColumnSearchExtras<HeldWorker> = {
    state: (w) => heldWorkerStateLabel(w),
    role: (w) => heldWorkerRoleLabel(w),
    heldAt: (w) => w.heldAt,
  };
</script>

<script lang="ts">
  import type { PortalColumnDef } from '$lib/table/features';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import DataTable from '$lib/components/table/DataTable.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import { makeGlobalFilterFn, searchableText } from '$lib/table/global-filter';
  import { t } from '$lib/i18n/t';
  import { workerLabel } from '$lib/workers/worker-label';

  let {
    workers,
    listKey = 'user:held-workers',
    bounded = false,
  }: { workers: HeldWorker[]; listKey?: string; bounded?: boolean } = $props();

  /** Epoch millis, so date columns sort by INSTANT (hrn:node:hadronmemory.com:hadron-portal:review:date-column-sorts-by-instant). */
  function dateMs(value: string | null | undefined): number | null {
    if (!value) return null;
    const ms = new Date(value).getTime();
    return Number.isNaN(ms) ? null : ms;
  }

  const STATE_RANK: Record<HeldWorkerState, number> = { active: 0, idle: 1, never: 2, unknown: 3 };

  // `t()` resolves once: a plain const, not $derived, so view state survives renders.
  const columns: PortalColumnDef<HeldWorker>[] = [
    {
      // Context-free list: a name is unique only within its App, so it is
      // qualified as `eng-team/Iris` (hrn:node:hadronmemory.com:specs:cor:agt:020:02,
      // via workerLabel) for the
      // link text, the sort and the search alike (@codex on #930).
      accessorFn: (w) => workerLabel(w.name, { context: 'org-wide', appSlugOrUrn: w.appUrn }),
      id: 'name',
      header: t('user.workers.col.name', 'Worker'),
      enableHiding: false,
      size: 200,
    },
    {
      // The accessor is the WORDS the cell shows, so the search matches only
      // what is on screen: a numeric rank here was searchable too, and "1"
      // found every idle worker (@codex on #930). The ORDER is the rank, by a
      // sorter of its own: active, then idle, never driven, and masked last.
      accessorFn: (w) => heldWorkerStateLabel(w),
      id: 'state',
      header: t('user.workers.col.state', 'State'),
      sortFn: (a, b) => STATE_RANK[heldWorkerState(a.original)] - STATE_RANK[heldWorkerState(b.original)],
      size: 220,
    },
    { accessorFn: (w) => w.role ?? '', id: 'role', header: t('user.workers.col.role', 'Role'), size: 150 },
    { accessorFn: (w) => w.appUrn ?? '', id: 'app', header: t('user.workers.col.app', 'App'), size: 260 },
    { accessorFn: (w) => w.urn ?? '', id: 'urn', header: t('user.workers.col.urn', 'URN'), size: 280 },
    {
      accessorFn: (w) => dateMs(w.heldAt),
      id: 'heldAt',
      header: t('user.workers.col.held', 'Held since'),
      size: 190,
    },
  ];

  const fmt: Record<string, (value: unknown) => string> = {
    heldAt: (v) => (typeof v === 'number' ? new Date(v).toLocaleString() : ''),
  };

  let globalFilter = $state('');

  const table = createSvelteTable<HeldWorker>({
    get data() {
      return workers;
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
    globalFilterFn: makeGlobalFilterFn<HeldWorker>(fmt, heldWorkerSearchExtras),
    initialState: {
      pagination: { pageIndex: 0, pageSize: 20 },
      // Active first: the tab answers "who is working right now" at a glance.
      sorting: [{ id: 'state', desc: false }],
    },
  });
</script>

<DataTable
  {table}
  {listKey}
  {bounded}
  bind:globalFilter
  searchPlaceholder={t('user.workers.search', 'Search workers…')}
  searchAriaLabel={t('user.workers.search.aria', 'Search the workers this user holds')}
>
  {#snippet cell(c, w)}
    {#if c.column.id === 'name'}
      {@const label = workerLabel(w.name, { context: 'org-wide', appSlugOrUrn: w.appUrn })}
      <!-- portal#2492: `truncate` on an inline <a> sets nowrap but never ellipsizes, so a long qualified label painted out of its cell. Block-level, with the full label in a title. -->
      <a href="/app/workers/{w.id}" class="block truncate text-sm font-medium text-zinc-900 hover:underline dark:text-white" title={label}>{label}</a>
    {:else if c.column.id === 'state'}
      {@const state = heldWorkerState(w)}
      {#if state === 'active'}
        <span data-testid="held-worker-active" class="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-950 dark:text-green-300">{heldWorkerStateLabel(w)}</span>
      {:else if state === 'unknown'}
        <span data-testid="held-worker-masked" class="text-sm italic text-zinc-400">{heldWorkerStateLabel(w)}</span>
      {:else}
        <span class="text-sm text-zinc-600 dark:text-zinc-300">{heldWorkerStateLabel(w)}</span>
      {/if}
    {:else if c.column.id === 'role'}
      {#if w.role}
        <span class="block truncate" title={w.role}>{w.role}</span>
      {:else}
        <span class="text-zinc-500">{t('user.workers.no-role', 'No role')}</span>
      {/if}
    {:else if c.column.id === 'app'}
      <!-- hrn:node:hadronmemory.com:hadron-portal:review:render-urn. Nullable by contract: absent, never an empty chip. -->
      {#if w.appUrn}
        <!-- Labelled, like every row carrying two chips: four buttons all
             named "Copy URN"/"Copy URL" cannot be told apart (@codex on #930). -->
        <Urn value={w.appUrn} type="app" size={8} linked label={t('user.workers.urn.app', 'App')} />
      {:else}
        <span class="text-zinc-400">—</span>
      {/if}
    {:else if c.column.id === 'urn'}
      {#if w.urn}
        <Urn value={w.urn} type="worker" size={8} linked label={t('user.workers.urn.worker', 'worker')} />
      {:else}
        <span class="text-zinc-400">—</span>
      {/if}
    {:else}
      {@const text = searchableText(fmt, c.column.id, c.getValue())}
      <!-- portal#2492: the date ellipsizes in a narrow column, so its full value stays in a title. -->
      <span class="block truncate" title={text === '' ? undefined : text}>{text === '' ? '—' : text}</span>
    {/if}
  {/snippet}
</DataTable>
