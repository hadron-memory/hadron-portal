<script lang="ts">
  // Modal picker for choosing a single agent — searchable + paginated. Mirrors
  // SelectMemory.svelte (same TanStack adapter, modal chrome, untrack reset);
  // agents have a display URN so rows use the Urn component, like SelectMemory.
  import type { PortalColumnDef } from '$lib/table/features';
  import { untrack } from 'svelte';
  import { focusTrap } from '$lib/a11y/focus-trap';
  import { consumeEscapeAtDialog, dialogEscapeFallback } from '$lib/a11y/dialog-escape';
  import { t } from '$lib/i18n/t';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import Urn from './Urn.svelte';

  interface Agent {
    id: string;
    name: string;
    urn: string;
    description?: string | null;
  }

  let {
    agents,
    placeholder = 'Search agents by name, URN, or description...',
    onselect,
    open = $bindable(false),
  }: {
    agents: Agent[];
    placeholder?: string;
    onselect: (agent: Agent) => void;
    open?: boolean;
  } = $props();

  let query = $state('');

  // NOTE: Headers render from this list, but the <td> cells in <tbody> are
  // hardcoded (custom URN/link markup) — same approach as SelectMemory. Keep
  // this column order in sync with the cells below, or they misalign.
  const columns: PortalColumnDef<Agent>[] = [
    { accessorKey: 'name', header: 'Name', enableHiding: false, size: 200 },
    { accessorKey: 'urn', header: 'URN', size: 250 },
    { accessorKey: 'description', header: 'Description', size: 200 },
  ];

  const table = createSvelteTable<Agent>({
    get data() {
      return Array.isArray(agents) ? agents.filter(Boolean) : [];
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
    globalFilterFn: (row, id, value) => {
      const searchValue = String(value ?? '').toLowerCase().trim();
      if (!searchValue) return true;
      const a = row.original;
      return (
        (a.name ?? '').toLowerCase().includes(searchValue) ||
        (a.urn ?? '').toLowerCase().includes(searchValue) ||
        (a.description ?? '').toLowerCase().includes(searchValue)
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
  const filteredRowCount = $derived(table.getFilteredRowModel().rows.length);

  function select(agent: Agent) {
    onselect(agent);
    open = false;
  }

  // The Select-family Escape pattern (#1582/#1584): Escape pressed INSIDE the
  // dialog is consumed at the dialog layer, so a host whose own window
  // listener registered first cannot close with us on one keypress; the
  // window fallback (the shared CAPTURE helper, with the consumed-key and IME
  // guards) owns the key only for a focus that never entered the dialog.
  const escapeFallback = { close: () => { open = false; } };

  // Reset search + pagination whenever the modal closes. `open` is the only
  // tracked dependency; the reset itself runs untracked because
  // table.resetPageIndex() reads *and* writes the table's reactive state via
  // the adapter's onStateChange — tracking that here would make the effect
  // self-invalidating and blow the update depth (effect_update_depth_exceeded).
  // See SelectMemory.svelte / PR #369.
  $effect(() => {
    if (open) return;
    untrack(() => {
      query = '';
      table.resetPageIndex();
    });
  });
</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="fixed inset-0 z-50 flex items-start justify-center pt-[10vh]" onclick={() => { open = false; }}>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('select-agent.title', 'Choose an agent')}
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
        <input
          type="text"
          bind:value={query}
          {placeholder}
          aria-label={placeholder}
          class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-white dark:placeholder-zinc-500"
        />
      </div>

      <!-- Table -->
      <div class="flex-1 overflow-auto">
        {#if rows.length === 0}
          <div class="px-4 py-8 text-center text-sm text-zinc-500">No agents found.</div>
        {:else}
          <table class="w-full text-sm border-collapse">
            <thead>
              <tr class="text-left text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                {#each table.getHeaderGroups()[0]?.headers ?? [] as header (header.id)}
                  <th class="sticky top-0 border-b border-zinc-200 bg-zinc-50 px-4 py-2 text-left dark:border-zinc-800 dark:bg-zinc-800" style="width: {header.getSize()}px;">
                    {header.column.columnDef.header}
                  </th>
                {/each}
                <th class="sticky top-0 border-b border-zinc-200 bg-zinc-50 px-4 py-2 dark:border-zinc-800 dark:bg-zinc-800 w-20"></th>
              </tr>
            </thead>
            <tbody>
              {#each rows as row (row.id)}
                <tr class="border-b border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800">
                  <td class="px-4 py-2 text-sm font-medium text-zinc-900 dark:text-white">{row.original.name}</td>
                  <td class="px-4 py-2 text-xs">
                    <div class="flex items-center gap-2">
                      <div class="min-w-0 flex-1">
                        <Urn value={row.original.urn} type="agent" size={10} compact />
                      </div>
                      <a href="/app/agents/{row.original.id}" target="_blank" rel="noopener noreferrer" title="Open agent" aria-label="Open agent" class="shrink-0 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                      </a>
                    </div>
                  </td>
                  <td class="px-4 py-2 text-sm text-zinc-600 dark:text-zinc-400"><span class="line-clamp-2">{row.original.description || '—'}</span></td>
                  <td class="px-4 py-2 text-right">
                    <button
                      type="button"
                      onclick={() => select(row.original)}
                      class="rounded bg-indigo-500 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-600 dark:bg-indigo-600 dark:hover:bg-indigo-700"
                    >
                      Select
                    </button>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </div>

      <!-- Footer with pagination -->
      <div class="border-t border-zinc-200 flex items-center justify-between px-4 py-3 text-xs text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
        <div>
          {rows.length > 0 && pageIndex >= 0 && pageCount > 0
            ? `${filteredRowCount} result${filteredRowCount !== 1 ? 's' : ''} · Page ${pageIndex + 1} of ${pageCount}`
            : `${filteredRowCount} result${filteredRowCount !== 1 ? 's' : ''}`}
        </div>
        <div class="flex gap-2">
          <button
            type="button"
            onclick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
            class="rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            ← Previous
          </button>
          <button
            type="button"
            onclick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
            class="rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Next →
          </button>
        </div>
        <div>Esc to close</div>
      </div>
    </div>
  </div>
{/if}
