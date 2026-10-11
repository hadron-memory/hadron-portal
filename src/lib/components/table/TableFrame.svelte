<!--
  #1021 — the one header every TanStack grid shares: the search / saved-views /
  Columns controls, folded behind a single toggle by default, and — when
  unfolded — drawn as the top edge of the table (shared border, no gap, the
  table's top corners squared) so the controls read as that table's header.

  The controls stay MOUNTED while folded (`hidden`, not `{#if}`): ViewTabs
  applies the default saved view from its own `onMount`, and the table must be
  filtered/sorted by it whether or not anyone unfolded the header.

  `active` marks a folded header whose global search is narrowing the rows (the
  dot tracks only that search) so a hidden filter is never silent.
-->
<script lang="ts">
  import { tick, type Snippet } from 'svelte';
  import { tableStrings } from '$lib/i18n/table-strings';

  let {
    controls,
    children,
    active = false,
    open = $bindable(false),
  }: {
    /** The search / ViewTabs / ColumnToggle row. */
    controls: Snippet;
    /** The table (its scroll container is the first child). */
    children: Snippet;
    /** The folded header holds a non-empty global search. */
    active?: boolean;
    open?: boolean;
  } = $props();

  // Stable across SSR and hydration (a random id would differ between them).
  const uid = $props.id();
  const panelId = `table-frame-${uid}`;

  let toggleEl = $state<HTMLButtonElement>();
  let panelEl = $state<HTMLDivElement>();

  // The toggle hides itself while the panel is open and the panel's Hide hides
  // the panel, so each move hands keyboard focus to the surviving control
  // instead of dropping it to <body>.
  async function setOpen(next: boolean) {
    open = next;
    await tick();
    if (next) panelEl?.querySelector<HTMLElement>('input, button, [tabindex]')?.focus();
    else toggleEl?.focus();
  }
</script>

<div data-testid="table-frame" class="min-w-0">
  <button
    type="button"
    data-testid="table-header-toggle"
    aria-expanded={open}
    aria-controls={panelId}
    bind:this={toggleEl}
    onclick={() => setOpen(true)}
    class="mb-2 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 dark:text-zinc-400 dark:hover:bg-zinc-800 {open ? 'hidden' : ''}"
  >
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
      <path d="M3 5a1 1 0 0 1 1-1h12a1 1 0 0 1 .8 1.6L12 12v4a1 1 0 0 1-1.45.9l-2-1A1 1 0 0 1 8 15v-3L3.2 5.6A1 1 0 0 1 3 5Z" />
    </svg>
    {tableStrings.showHeader()}
    {#if active}<span data-testid="table-header-active" class="h-1.5 w-1.5 rounded-full bg-indigo-500" title={tableStrings.headerActive()}></span>{/if}
  </button>

  <div
    id={panelId}
    bind:this={panelEl}
    hidden={!open}
    data-testid="table-header"
    class="{open ? 'flex' : 'hidden'} flex-wrap items-center gap-3 rounded-t-lg border border-b-0 border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900"
  >
    <div class="flex min-w-0 flex-1 flex-wrap items-center gap-3">
      {@render controls()}
    </div>
    <button
      type="button"
      data-testid="table-header-hide"
      aria-expanded={open}
      aria-controls={panelId}
      onclick={() => setOpen(false)}
      class="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 dark:text-zinc-400 dark:hover:bg-zinc-800"
    >{tableStrings.hideHeader()}</button>
  </div>

  <div class={open ? '[&>:first-child]:rounded-t-none' : ''}>
    {@render children()}
  </div>
</div>
