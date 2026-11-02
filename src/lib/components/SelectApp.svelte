<script module lang="ts">
  export type AppChoice = { id: string; name: string; urn: string };
</script>
<script lang="ts">
  import { untrack } from 'svelte';
  import { pickerStrings } from '$lib/i18n/picker-strings';
  import { focusTrap } from '$lib/a11y/focus-trap';
  import { consumeEscapeAtDialog, dialogEscapeFallback } from '$lib/a11y/dialog-escape';
  import { t } from '$lib/i18n/t';
  import type { PortalColumnDef } from '$lib/table/features';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import DataTable from './table/DataTable.svelte';
  import Urn from './Urn.svelte';
  let { apps, scopeKey, onselect, open = $bindable(false) }: {
    apps: AppChoice[]; scopeKey: string; onselect: (app: AppChoice) => void; open?: boolean;
  } = $props();
  let query = $state('');
  const columns: PortalColumnDef<AppChoice>[] = [
    { id: 'app', accessorFn: (app) => `${app.name} ${app.urn}`, header: t('select-app.app', 'App'), enableHiding: false, size: 280, minSize: 180 },
  ];
  const table = createSvelteTable<AppChoice>({
    get data() { return apps; }, columns,
    getRowId: (app) => app.id,
    state: { get globalFilter() { return query; } },
    onGlobalFilterChange: (update) => { query = typeof update === 'function' ? update(query) : update; },
    globalFilterFn: (row, _column, value) => `${row.original.name} ${row.original.urn}`.toLowerCase().includes(String(value).toLowerCase()),
    initialState: { pagination: { pageIndex: 0, pageSize: 5 } },
  });
  $effect(() => {
    if (open) return;
    untrack(() => { query = ''; table.resetPageIndex(); });
  });

  // Escape: consumed at this dialog's own layer — the shared helper owns the
  // layering contract and the guards (src/lib/a11y/dialog-escape.ts).
  const escapeFallback = { close: () => { open = false; } };
</script>
{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-3 pt-[10vh]" onclick={() => open = false}>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div role="dialog" aria-modal="true" aria-label={t('select-app.title', 'Choose an App')} tabindex="-1" use:focusTrap use:dialogEscapeFallback={escapeFallback} onclick={(e) => e.stopPropagation()} onkeydown={(e) => consumeEscapeAtDialog(e, escapeFallback)} class="w-full max-w-2xl min-w-0 rounded-xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
      <div class="mb-3 flex items-center justify-between gap-3">
        <h2 class="font-semibold text-zinc-900 dark:text-white">{t('select-app.title', 'Choose an App')}</h2>
        <button type="button" onclick={() => open = false} class="rounded-md px-3 py-1 text-sm text-zinc-600 dark:text-zinc-300">{t('select-app.close', 'Close')}</button>
      </div>
      <DataTable {table} listKey={`select-app:${scopeKey}`} bind:globalFilter={query} searchPlaceholder={t('select-app.search', 'Search Apps...')} searchAriaLabel={t('select-app.search', 'Search Apps...')} maxHeight="45vh">
        {#snippet cell(cell, app)}
          <!-- Keep selection in the same cell as identity: a second fixed
               column would put the primary action beyond a phone viewport. -->
          <div class="flex min-w-0 items-center gap-3">
            <div class="min-w-0 flex-1"><p class="truncate font-medium text-zinc-900 dark:text-white">{app.name}</p><div class="mt-1"><Urn value={app.urn} type="app" size={10} /></div></div>
            <button type="button" onclick={() => { onselect(app); open = false; }} aria-label={pickerStrings.selectNamed(app.name)} class="shrink-0 rounded-md bg-indigo-600 px-3 py-1.5 text-sm text-white pointer-coarse:min-h-11 hover:bg-indigo-500">{t('select-app.select', 'Select')}</button>
          </div>
        {/snippet}
      </DataTable>
      {#if apps.length === 0}<p class="mt-3 text-sm text-zinc-500 dark:text-zinc-400">{t('select-app.empty', 'No Apps in this organization.')}</p>{/if}
    </div>
  </div>
{/if}
