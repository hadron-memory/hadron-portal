<script lang="ts">
  import type { PortalColumnDef } from '$lib/table/features';
  import { pickerStrings } from '$lib/i18n/picker-strings';
  import { onDestroy, untrack } from 'svelte';
  import { focusTrap } from '$lib/a11y/focus-trap';
  import { consumeEscapeAtDialog, dialogEscapeFallback } from '$lib/a11y/dialog-escape';
  import { t } from '$lib/i18n/t';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import LiveRegion from './LiveRegion.svelte';
  import Urn from './Urn.svelte';

  interface Memory {
    id: string;
    name: string;
    urn: string;
    visibility?: string | null;
    orgName?: string;
  }

  let {
    memories,
    placeholder = 'Search memories by name or URN...',
    onselect,
    open = $bindable(false),
    clearOf = null,
    keepOpen = false,
    addedIds = null,
    note = '',
    remote = null,
  }: {
    memories: Memory[];
    placeholder?: string;
    onselect: (memory: Memory) => void;
    open?: boolean;
    /**
     * #1590: when stacked over a host dialog, the host element this picker
     * must not cover (SelectNode's header row, with its title and Close).
     * The picker starts below that element's bottom edge (its 70vh height
     * still fits under a host header on any viewport taller than ~270px).
     * Measured while open, and again on resize and on any scroll (#1600
     * item 4: a scroll chaining to the host dialog moves its header).
     */
    clearOf?: HTMLElement | null;
    /** #1736: several picks in one sitting. Selecting leaves the picker open, with Done to close it. */
    keepOpen?: boolean;
    /** Memories already picked: their rows read "Added" and cannot be picked again. */
    addedIds?: ReadonlySet<string> | null;
    /** A status line the host owns, such as how many are picked and the limit. */
    note?: string;
    /**
     * The host searches and pages on the server: `memories` is the current page only, and the picker neither filters nor
     * pages it locally. Typing calls `onquery` (debounced, back on page one), Previous and Next call `onpage`. `error` is
     * a message the host already worded; `loading` is a read in flight.
     */
    remote?: { total: number; pageSize: number; loading: boolean; error: string | null; onquery: (query: string) => void; onpage: (pageIndex: number) => void } | null;
  } = $props();

  const QUERY_DEBOUNCE_MS = 300;
  let remotePage = $state(0);
  let debounce: ReturnType<typeof setTimeout> | undefined;
  function typed() {
    if (!remote) return;
    clearTimeout(debounce);
    debounce = setTimeout(() => { remotePage = 0; remote?.onquery(query); }, QUERY_DEBOUNCE_MS);
  }
  function goto(index: number) { remotePage = index; remote?.onpage(index); }
  onDestroy(() => clearTimeout(debounce));

  const STACK_GAP = 8; // px between the host's edge and this dialog
  let clearTop = $state<number | null>(null);
  $effect(() => {
    if (!open || !clearOf) {
      clearTop = null;
      return;
    }
    const host = clearOf;
    const measure = () => { clearTop = host.getBoundingClientRect().bottom + STACK_GAP; };
    measure();
    // Scroll does not bubble, so only a capture-phase listener on window sees
    // a scroll on an inner scroller (the host dialog's own list, say).
    const scrollOpts = { capture: true, passive: true } as const;
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, scrollOpts);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, scrollOpts);
    };
  });

  // #1600 item 1: one string is both the visible heading and the dialog's
  // accessible name, so the two cannot drift apart.
  const title = $derived(t('select-memory.title', 'Choose a memory'));

  let query = $state('');

  const columns: PortalColumnDef<Memory>[] = [
    { accessorKey: 'name', header: 'Name', enableHiding: false, size: 200 },
    { accessorKey: 'urn', header: 'URN', size: 250 },
    { accessorKey: 'orgName', header: 'Organization', size: 150 },
  ];

  // Stable row-data identity — see SelectUser.svelte (#414). TanStack's
  // autoResetPageIndex resets pagination whenever the `data` *reference*
  // changes; returning a fresh `memories.filter(Boolean)` array on every read
  // re-fires onStateChange in a render→reset→render loop that can freeze the
  // page. A $derived memoizes the array so its identity only changes when
  // `memories` actually changes.
  const rowData = $derived(Array.isArray(memories) ? memories.filter(Boolean) : []);

  const table = createSvelteTable<Memory>({
    get data() {
      return rowData;
    },
    columns,
    state: {
      get globalFilter() {
        return query;
      },
    },
    onGlobalFilterChange: (u) => {
      query = typeof u === 'function' ? u(query) : u;
    },
    // Remote mode: the server already matched and paged, so the grid shows exactly the rows it was given.
    get manualFiltering() { return !!remote; },
    get manualPagination() { return !!remote; },
    globalFilterFn: (row, id, value) => {
      const searchValue = String(value ?? '').toLowerCase().trim();
      if (!searchValue) return true;
      return (
        (row.original.name ?? '').toLowerCase().includes(searchValue) ||
        (row.original.urn ?? '').toLowerCase().includes(searchValue)
      );
    },
    initialState: {
      pagination: {
        pageIndex: 0,
        pageSize: 5,
      },
    },
  });

  const rows = $derived(table.getRowModel().rows);
  const pageIndex = $derived(table.atoms.pagination.get().pageIndex);
  const pageCount = $derived(table.getPageCount());
  const filteredRowCount = $derived(remote ? remote.total : table.getFilteredRowModel().rows.length);
  const remotePageCount = $derived(remote ? Math.max(1, Math.ceil(remote.total / remote.pageSize)) : 0);

  function select(memory: Memory) {
    if (addedIds?.has(memory.id)) return;
    onselect(memory);
    if (!keepOpen) open = false;
  }

  // Escape: consumed at this dialog's own layer — the shared helper owns the
  // layering contract and the guards (src/lib/a11y/dialog-escape.ts).
  const escapeFallback = { close: () => { open = false; } };

  // Reset search + pagination whenever the modal closes. `open` is the only
  // tracked dependency; the reset itself runs untracked because
  // table.resetPageIndex() reads *and* writes the table's reactive state via
  // the adapter's onStateChange — tracking that here would make the effect
  // self-invalidating and blow the update depth (effect_update_depth_exceeded).
  $effect(() => {
    if (open) return;
    untrack(() => {
      clearTimeout(debounce);
      remotePage = 0;
      query = '';
      table.resetPageIndex();
    });
  });
</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="fixed inset-0 z-50 flex items-start justify-center px-2 pt-[10vh]"
    style={clearTop === null ? undefined : `padding-top: max(10vh, ${clearTop}px);`}
    onclick={() => { open = false; }}>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      tabindex="-1"
      use:focusTrap
      use:dialogEscapeFallback={escapeFallback}
      class="w-full max-w-2xl rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900 flex flex-col"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => consumeEscapeAtDialog(e, escapeFallback)}
      style="max-height: 70vh;"
    >
      <!-- Header with search. The input must NOT focus itself via an action:
           child actions run before the parent focusTrap captures
           document.activeElement, so a self-focusing input gets recorded as
           the opener and focus is never restored on close (portal#1305). The
           trap moves focus to the first tabbable control — this input — after
           capturing the real opener. -->
      <div class="border-b border-zinc-200 p-4 dark:border-zinc-700">
        <h2 class="mb-2 text-sm font-semibold text-zinc-900 dark:text-white">{title}</h2>
        <input
          type="text"
          bind:value={query}
          oninput={typed}
          {placeholder}
          aria-label={placeholder}
          class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-white dark:placeholder-zinc-500"
        />
        {#if keepOpen}<p role="status" class="mt-2 text-xs text-zinc-600 dark:text-zinc-400">{note}</p>{/if}
      </div>

      <!-- Table -->
      <div class="flex-1 overflow-auto">
        {#if remote}
          <!-- Persistent regions: the status and the refusal are announced as content that changes inside them (portal#2344). -->
          <LiveRegion>{#if remote.loading && rows.length === 0}<p class="px-4 py-8 text-center text-sm text-zinc-500">{t('select-memory.loading', 'Loading…')}</p>{/if}</LiveRegion>
          <LiveRegion>{#if remote.error}<p class="px-4 py-8 text-center text-sm text-red-600 dark:text-red-400">{remote.error}</p>{/if}</LiveRegion>
        {/if}
        {#if remote?.error || (remote?.loading && rows.length === 0)}
        {:else if rows.length === 0}
          <div class="px-4 py-8 text-center text-sm text-zinc-500">No memories found.</div>
        {:else}
          <table class="w-full table-fixed border-collapse text-sm sm:table-auto">
            <thead>
              <tr class="text-left text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                {#each table.getHeaderGroups()[0]?.headers ?? [] as header (header.id)}
                  <!-- #1600 item 2: below sm the table is fixed-layout with no
                       imposed widths (they sum past a phone's width, and a
                       truncating URN chip's min-content is its full text in an
                       auto table), and Organization folds into the Name cell,
                       so every control stays inside the panel. -->
                  <th class="sticky top-0 border-b border-zinc-200 bg-zinc-50 px-2 py-2 text-left sm:w-(--col-w) sm:px-4 dark:border-zinc-800 dark:bg-zinc-800 {header.column.id === 'orgName' ? 'hidden sm:table-cell' : ''}" style="--col-w: {header.getSize()}px;">
                    {header.column.columnDef.header}
                  </th>
                {/each}
                <th class="sticky top-0 border-b border-zinc-200 bg-zinc-50 w-20 px-2 py-2 sm:px-4 dark:border-zinc-800 dark:bg-zinc-800"></th>
              </tr>
            </thead>
            <tbody>
              {#each rows as row (row.id)}
                <tr class="border-b border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800">
                  <td class="px-2 py-2 text-sm font-medium break-words text-zinc-900 sm:px-4 dark:text-white">
                    {row.original.name}
                    <!-- #1604: only a real org folds under the name. Here a "—"
                         is an unlabelled stray glyph, not an empty cell. -->
                    {#if row.original.orgName}
                      <div class="mt-1 text-xs font-normal text-zinc-600 sm:hidden dark:text-zinc-400">{row.original.orgName}</div>
                    {/if}
                  </td>
                  <td class="px-2 py-2 text-xs sm:px-4">
                    <div class="flex items-center gap-2">
                      <div class="min-w-0 flex-1">
                        <Urn value={row.original.urn} type="memory" size={10} compact />
                      </div>
                      <a href="/app/memories/{row.original.id}" target="_blank" rel="noopener noreferrer" title="Open memory" class="shrink-0 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                      </a>
                    </div>
                  </td>
                  <td class="hidden px-4 py-2 text-sm text-zinc-600 sm:table-cell dark:text-zinc-400">{row.original.orgName || '—'}</td>
                  <td class="px-2 py-2 text-right sm:px-4">
                    <!-- aria-disabled, not disabled: picking must not drop focus out of the dialog. -->
                    <button
                      type="button"
                      onclick={() => select(row.original)}
                      aria-disabled={addedIds?.has(row.original.id) ? 'true' : undefined}
                      aria-label={addedIds?.has(row.original.id) ? t('select-memory.added-named', 'Added {name}', { name: row.original.name }) : pickerStrings.selectNamed(row.original.name)}
                      class="rounded px-3 py-1 text-xs font-medium pointer-coarse:min-h-11 {addedIds?.has(row.original.id) ? 'border border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300' : 'bg-indigo-500 text-white hover:bg-indigo-600 dark:bg-indigo-600 dark:hover:bg-indigo-700'}"
                    >
                      {addedIds?.has(row.original.id) ? t('select-memory.added', 'Added') : pickerStrings.select()}
                    </button>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </div>

      <!-- Footer with pagination -->
      <div class="border-t border-zinc-200 flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-xs text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
        <div>
          {remote
            ? (rows.length > 0 ? `${filteredRowCount} result${filteredRowCount !== 1 ? 's' : ''} · Page ${remotePage + 1} of ${remotePageCount}` : `${filteredRowCount} result${filteredRowCount !== 1 ? 's' : ''}`)
            : rows.length > 0 && pageIndex >= 0 && pageCount > 0
            ? `${filteredRowCount} result${filteredRowCount !== 1 ? 's' : ''} · Page ${pageIndex + 1} of ${pageCount}`
            : `${filteredRowCount} result${filteredRowCount !== 1 ? 's' : ''}`}
        </div>
        <div class="flex gap-2">
          <button
            type="button"
            onclick={() => (remote ? goto(remotePage - 1) : table.previousPage())}
            disabled={remote ? remote.loading || remotePage <= 0 : !table.getCanPreviousPage()}
            class="rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            ← Previous
          </button>
          <button
            type="button"
            onclick={() => (remote ? goto(remotePage + 1) : table.nextPage())}
            disabled={remote ? remote.loading || remotePage + 1 >= remotePageCount : !table.getCanNextPage()}
            class="rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Next →
          </button>
        </div>
        <!-- #1600 item 3: keyboard help; a touch device has no Esc. -->
        <div class="pointer-coarse:hidden">Esc to close</div>
        {#if keepOpen}<button type="button" onclick={() => { open = false; }} class="min-h-11 rounded bg-indigo-600 px-3 text-white">{t('select-memory.done', 'Done')}</button>{/if}
      </div>
    </div>
  </div>
{/if}
