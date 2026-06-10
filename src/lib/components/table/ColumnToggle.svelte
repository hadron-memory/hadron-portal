<script lang="ts">
  // Reusable column show/hide control for the unified grid. Lists already render
  // via row.getVisibleCells()/headerGroup.headers, so toggling a column's
  // visibility hides it everywhere automatically. Saved views capture/restore the
  // resulting columnVisibility for free.
  import type { Table, Column } from '@tanstack/table-core';
  import { t } from '$lib/i18n/t';

  let { table }: { table: Table<any> } = $props();

  // Only columns that are allowed to hide (the identity column opts out via
  // enableHiding:false in the list's column defs).
  const columns = $derived(table.getAllLeafColumns().filter((c) => c.getCanHide()));

  let open = $state(false);
  let detailsEl = $state<HTMLDetailsElement>();

  function label(c: Column<any>): string {
    const h = c.columnDef.header;
    return typeof h === 'string' ? h : c.id;
  }

  // Close the dropdown on outside-click or Escape (native <details> stays open
  // otherwise). Listeners are only attached while open.
  $effect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (detailsEl && !detailsEl.contains(e.target as Node)) open = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') open = false;
    };
    // Defer the click listener a tick so the opening click doesn't close it.
    const timer = setTimeout(() => document.addEventListener('click', onClick), 0);
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
    };
  });
</script>

{#if columns.length > 0}
  <details bind:this={detailsEl} bind:open class="relative">
    <summary class="cursor-pointer list-none rounded-md border border-zinc-300 bg-zinc-100 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-200 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700">
      {t('table.columns', 'Columns')} ▾
    </summary>
    <div class="absolute right-0 z-20 mt-1 w-44 rounded-lg border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
      {#each columns as col (col.id)}
        <label class="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">
          <input type="checkbox" checked={col.getIsVisible()} onchange={col.getToggleVisibilityHandler()} />
          {label(col)}
        </label>
      {/each}
    </div>
  </details>
{/if}
