<script lang="ts">
  // BAKE-OFF SPIKE (#275 follow-up) — NodeList on AG Grid Community via the
  // vanilla createGrid() API (no Svelte component wrapper, since the only Svelte
  // 5 wrapper is dormant). Read-only; mirrors the TanStack spike's features so
  // they can be compared. Not wired into the app.
  import { onMount, onDestroy } from 'svelte';
  import {
    createGrid,
    ModuleRegistry,
    AllCommunityModule,
    type GridApi,
    type GridOptions,
    type ColDef,
    type GridState,
  } from 'ag-grid-community';
  import type { MemoryNode } from '$lib/types';

  // Community modules must be registered once before any grid is created.
  ModuleRegistry.registerModules([AllCommunityModule]);

  let {
    nodes,
    basePath = '',
    initialState = undefined,
  }: { nodes: MemoryNode[]; basePath?: string; initialState?: GridState } = $props();

  let gridDiv: HTMLDivElement;
  let api: GridApi<MemoryNode> | undefined;
  let viewJson = $state('');

  const columnDefs: ColDef<MemoryNode>[] = [
    {
      field: 'name',
      headerName: 'Node',
      cellRenderer: (p: { data?: MemoryNode; value: string }) => {
        if (basePath && p.data) {
          const a = document.createElement('a');
          a.href = `${basePath}/nodes/${p.data.id}`;
          a.textContent = p.value;
          a.className = 'font-medium text-indigo-600 hover:underline';
          return a;
        }
        return p.value;
      },
    },
    { field: 'nodeType', headerName: 'Type' },
    { field: 'description', headerName: 'Description', valueFormatter: (p) => p.value ?? '—' },
  ];

  const gridOptions: GridOptions<MemoryNode> = {
    columnDefs,
    rowData: nodes,
    defaultColDef: { sortable: true, filter: true, resizable: true, flex: 1 },
    pagination: true,
    paginationPageSize: 25,
    paginationPageSizeSelector: [10, 25, 100],
    initialState,
    // Keep the serialized-view preview live.
    onStateUpdated: () => {
      if (api) viewJson = JSON.stringify(api.getState());
    },
  };

  onMount(() => {
    api = createGrid(gridDiv, gridOptions);
    viewJson = JSON.stringify(api.getState());
  });

  onDestroy(() => api?.destroy());

  // Data reactivity is imperative: push new rows through the grid API.
  $effect(() => {
    api?.setGridOption('rowData', nodes);
  });
</script>

<div class="space-y-3">
  <div bind:this={gridDiv} style="height: 480px;"></div>

  <details class="text-xs">
    <summary class="cursor-pointer text-zinc-500">Saved view (serialized JSON via api.getState())</summary>
    <pre class="mt-1 overflow-x-auto rounded bg-zinc-100 p-2 dark:bg-zinc-900">{viewJson}</pre>
  </details>
</div>
