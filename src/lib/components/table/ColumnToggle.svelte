<script lang="ts" generics="T extends RowData">
  // Reusable column show/hide control for the unified grid. Lists already render
  // via row.getVisibleCells()/headerGroup.headers, so toggling a column's
  // visibility hides it everywhere automatically. Saved views capture/restore the
  // resulting columnVisibility for free.
  //
  // Generic over the row type rather than taking `PortalTable<any>`: TanStack v9
  // declares `TData` invariant (`in out`), so a `PortalTable<AgentRow>` is NOT
  // assignable to a `PortalTable<any>` the way it was under v8.
  import type { PortalTable, PortalColumn } from '$lib/table/features';
  import type { RowData } from '@tanstack/table-core';
  import { consumeEscapeAtDialog, dialogEscapeFallback } from '$lib/a11y/dialog-escape';
  import { t } from '$lib/i18n/t';
  import { columnMenuAlign, COLUMN_MENU_WIDTH_PX, type ColumnMenuAlign } from './columnMenuAlign';

  let { table }: { table: PortalTable<T> } = $props();

  // Only columns that are allowed to hide (the identity column opts out via
  // enableHiding:false in the list's column defs).
  const columns = $derived(table.getAllLeafColumns().filter((c) => c.getCanHide()));

  let open = $state(false);
  let detailsEl = $state<HTMLDetailsElement>();
  let summaryEl = $state<HTMLElement>();
  // Recomputed on every open and on every viewport resize while open, from the
  // summary's position and the menu's width (COLUMN_MENU_WIDTH_PX is also
  // applied as the menu's inline width, so there is one source). Only `align`
  // changes: the menu stays open and the column choices are untouched (#2186).
  let align = $state<ColumnMenuAlign>('right');
  function measure() {
    if (!summaryEl) return;
    align = columnMenuAlign(summaryEl.getBoundingClientRect(), COLUMN_MENU_WIDTH_PX);
  }
  $effect.pre(() => {
    if (!open || !summaryEl) return;
    measure();
  });
  $effect(() => {
    if (!open) return;
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  });

  // A plain stable object (never spread) so the close closure stays live
  // (hrn:node:hadronmemory.com:hadron-portal:review:preserve-getters-when-wrapping-options).
  const dropdownEscape = { close: () => { open = false; } };

  function label(c: PortalColumn<T>): string {
    const h = c.columnDef.header;
    return typeof h === 'string' ? h : c.id;
  }

  // Close the dropdown on outside-click (native <details> stays open
  // otherwise; Escape is handled at the element and by the armed fallback
  // below). Listeners are only attached while open.
  $effect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (detailsEl && !detailsEl.contains(e.target as Node)) open = false;
    };
    // Defer the click listener a tick so the opening click doesn't close it.
    const timer = setTimeout(() => document.addEventListener('click', onClick), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', onClick);
    };
  });
</script>

{#if columns.length > 0}
  <!-- The dropdown owns Escape wherever focus sits (#1584, #1587 review):
       it consumes at its OWN element for a focus inside (the dialog's bubble
       handler would outrank a document listener), and — because it can stay
       open while focus sits on another picker control or on <body> — the
       open dropdown content also arms the shared CAPTURE fallback
       (`{#if open}` gates the armed lifetime exactly). The armed stack makes
       the layer opened last the topmost, so the dropdown resolves the key at
       window-capture before any dialog element handler can bubble.
       `suppressed` on the element consumption passes the key through while
       the dropdown is closed — then it is the dialog's to take. -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <!-- (`details` is natively interactive via its summary; the keydown is the
       Escape consumption above, not new mouse/keyboard behavior.) -->
  <details
    bind:this={detailsEl}
    bind:open
    class="relative"
    onkeydown={(event) => consumeEscapeAtDialog(event, { close: dropdownEscape.close, suppressed: () => !open })}
  >
    <summary bind:this={summaryEl} class="cursor-pointer list-none rounded-md border border-zinc-300 bg-zinc-100 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-200 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700">
      {t('table.columns', 'Columns')} ▾
    </summary>
    {#if open}
      <div
        use:dialogEscapeFallback={dropdownEscape}
        style="width: {COLUMN_MENU_WIDTH_PX}px"
        class="absolute {align === 'right' ? 'right-0' : 'left-0'} z-20 mt-1 rounded-lg border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
      >
        {#each columns as col (col.id)}
          <label class="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">
            <input type="checkbox" checked={col.getIsVisible()} onchange={col.getToggleVisibilityHandler()} />
            {label(col)}
          </label>
        {/each}
      </div>
    {/if}
  </details>
{/if}
