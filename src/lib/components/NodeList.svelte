<script lang="ts">
  import { createTable, Subscribe, Render } from 'svelte-headless-table';
  import { addSortBy, addTableFilter, addColumnFilters, addResizedColumns } from 'svelte-headless-table/plugins';
  import { readable } from 'svelte/store';
  import Urn from './Urn.svelte';
  import { composeNodeUrn } from '$lib/urn/compose-node-urn';
  import type { MemoryNode } from '$lib/types';

  let {
    nodes,
    basePath = '',
    memoryUrn = '',
    orderable = false,
    onreorder,
  }: {
    nodes: MemoryNode[];
    basePath?: string;
    memoryUrn?: string;
    orderable?: boolean;
    onreorder?: (orderedLocs: string[]) => void;
  } = $props();

  function nodeHref(node: MemoryNode): string {
    if (basePath) return `${basePath}/nodes/${node.id}`;
    // #260: memory pages are org-less, so the fallback needs only the memory id.
    const memId = node.memory?.id;
    if (memId) return `/app/memories/${memId}/nodes/${node.id}`;
    return '';
  }

  function nodeUrn(node: MemoryNode): string {
    // Some queries don't populate node.memory. If neither the prop nor
    // the node carries a memory URN, render bare loc rather than throw
    // and take down the whole list — the missing-memory case is a data-
    // shape concern that should be fixed at the loader, not here.
    // R-2 (2026-05-06): also guard empty node.loc for the same reason.
    const u = memoryUrn || node.memory?.urn || '';
    return u && node.loc ? composeNodeUrn(u, node.loc) : node.loc;
  }

  const store = $derived(readable(nodes));

  const table = $derived(createTable(store, {
    sort: addSortBy({ disableMultiSort: true }),
    filter: addTableFilter({
      fn: ({ filterValue, value }) =>
        String(value).toLowerCase().includes(String(filterValue).toLowerCase()),
    }),
    resize: addResizedColumns(),
  }));

  const columns = $derived(table.createColumns([
    table.column({
      accessor: 'name',
      header: 'Node',
      cell: ({ value }) => value,
    }),
    table.column({
      accessor: 'nodeType',
      header: 'Type',
    }),
    table.column({
      accessor: (row) => row.description ?? '',
      header: 'Description',
      id: 'description',
    }),
  ]));

  const vm = $derived(table.createViewModel(columns));
  const headerRows = $derived(vm.headerRows);
  const rows = $derived(vm.rows);
  const tableAttrs = $derived(vm.tableAttrs);
  const tableBodyAttrs = $derived(vm.tableBodyAttrs);
  const filterValue = $derived(vm.pluginStates.filter.filterValue);

  // Drag-and-drop reordering
  let dragIdx = $state<number | null>(null);
  let dropIdx = $state<number | null>(null);

  function handleDragStart(e: DragEvent, idx: number) {
    if (!orderable || !onreorder) return;
    dragIdx = idx;
    e.dataTransfer!.effectAllowed = 'move';
  }

  function handleDragOver(e: DragEvent, idx: number) {
    if (dragIdx === null || dragIdx === idx) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'move';
    dropIdx = idx;
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    if (dragIdx === null || dropIdx === null || !onreorder) { resetDrag(); return; }
    const ordered = [...nodes];
    const [moved] = ordered.splice(dragIdx, 1);
    ordered.splice(dropIdx, 0, moved);
    onreorder(ordered.map((n) => n.loc));
    resetDrag();
  }

  function resetDrag() { dragIdx = null; dropIdx = null; }
</script>

<div class="space-y-3">
  <input type="text" placeholder="Search nodes..." bind:value={$filterValue}
    class="max-w-sm rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500" />

  {#if nodes.length === 0}
    <p class="text-sm text-zinc-500">No nodes.</p>
  {:else}
    <div class="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
      <table {...$tableAttrs} class="w-full text-sm">
        <thead>
          {#each $headerRows as headerRow (headerRow.id)}
            <Subscribe rowAttrs={headerRow.attrs()} let:rowAttrs>
              <tr {...rowAttrs} class="border-b border-zinc-200 bg-zinc-50 text-left text-xs font-medium uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                {#if orderable}<th class="w-8 px-2 py-2.5"></th>{/if}
                {#each headerRow.cells as cell (cell.id)}
                  <Subscribe attrs={cell.attrs()} let:attrs props={cell.props()} let:props>
                    <th {...attrs} class="px-4 py-2.5 cursor-pointer select-none hover:text-zinc-700 dark:hover:text-zinc-200"
                      onclick={props.sort.toggle}
                      style={(props.resize as unknown as { style?: string })?.style ? `width: ${(props.resize as unknown as { style?: string }).style}` : undefined}
                    >
                      <div class="flex items-center gap-1">
                        <Render of={cell.render()} />
                        {#if props.sort.order === 'asc'}
                          <span class="text-indigo-500">▲</span>
                        {:else if props.sort.order === 'desc'}
                          <span class="text-indigo-500">▼</span>
                        {:else}
                          <span class="text-zinc-300 dark:text-zinc-700">⇅</span>
                        {/if}
                      </div>
                    </th>
                  </Subscribe>
                {/each}
              </tr>
            </Subscribe>
          {/each}
        </thead>
        <tbody {...$tableBodyAttrs} class="divide-y divide-zinc-200 dark:divide-zinc-800">
          {#each $rows as row, idx (row.id)}
            {@const n = (row as unknown as { original: MemoryNode }).original}
            {@const href = nodeHref(n)}
            <Subscribe rowAttrs={row.attrs()} let:rowAttrs>
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <tr {...rowAttrs}
                class="bg-white hover:bg-zinc-50 dark:bg-zinc-950 dark:hover:bg-zinc-900
                  {dropIdx === idx && dragIdx !== null ? 'border-t-2 border-indigo-500' : ''}"
                draggable={orderable && onreorder ? 'true' : undefined}
                ondragstart={(e) => handleDragStart(e, idx)}
                ondragover={(e) => handleDragOver(e, idx)}
                ondragleave={() => { dropIdx = null; }}
                ondrop={handleDrop}
                ondragend={resetDrag}
              >
                {#if orderable}
                  <td class="w-8 px-2 py-2.5 text-zinc-400 cursor-grab select-none" title="Drag to reorder">⠿</td>
                {/if}
                {#each row.cells as cell (cell.id)}
                  <Subscribe attrs={cell.attrs()} let:attrs>
                    {#if cell.id === 'name'}
                      <td {...attrs} class="px-4 py-2.5">
                        <div>
                          {#if href}
                            <a {href} class="font-medium text-indigo-600 hover:underline dark:text-indigo-300">{n.name}</a>
                          {:else}
                            <span class="font-medium text-zinc-900 dark:text-white">{n.name}</span>
                          {/if}
                          {#if n.seq !== null && n.seq !== undefined}
                            <span class="ml-1 text-xs tabular-nums text-zinc-400">#{n.seq}</span>
                          {/if}
                        </div>
                        <div class="mt-0.5"><Urn value={nodeUrn(n)} type="node" size={8} /></div>
                      </td>
                    {:else if cell.id === 'nodeType'}
                      <td {...attrs} class="px-4 py-2.5">
                        <span class="rounded px-1.5 py-0.5 text-xs font-medium bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">{n.nodeType}</span>
                      </td>
                    {:else if cell.id === 'description'}
                      <td {...attrs} class="max-w-xs truncate px-4 py-2.5 text-xs text-zinc-500">{n.description ?? '—'}</td>
                    {:else}
                      <td {...attrs} class="px-4 py-2.5 text-zinc-600 dark:text-zinc-400">
                        <Render of={cell.render()} />
                      </td>
                    {/if}
                  </Subscribe>
                {/each}
              </tr>
            </Subscribe>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>
