<script lang="ts">
  // GitHub-style saved-views tab strip (spec 020 follow-up). A horizontal,
  // scrollable strip of view tabs over the shared viewController. The active
  // tab carries a ▾ menu (rename/duplicate/set-default/delete) rendered as a
  // fixed-position popover so it isn't clipped by the strip's overflow; Save /
  // Reset surface as prominent buttons when the view is modified.
  import { onMount } from 'svelte';
  import type { Table } from '@tanstack/table-core';
  import { createViewController } from '$lib/table/viewController.svelte';
  import { localStorageViewStore } from '$lib/table/localStorageViewStore';
  import { type ViewStore, ViewStorageError } from '$lib/table/viewStore';
  import { savedViewsStrings as s } from '$lib/i18n/saved-views-strings';

  let {
    table,
    listKey,
    store = localStorageViewStore,
  }: { table: Table<any>; listKey: string; store?: ViewStore } = $props();

  const ctrl = createViewController({ table, listKey, store });

  // Default view first (GitHub puts the default leftmost); sort is stable for the rest.
  const sortedViews = $derived([...ctrl.views].sort((a, b) => Number(b.isDefault) - Number(a.isDefault)));

  let error = $state<string | null>(null);
  async function run(action: Promise<unknown> | void) {
    try {
      await action;
      error = null;
    } catch (e) {
      error = e instanceof ViewStorageError ? e.message : 'Could not update views.';
    }
  }

  onMount(() => {
    run(ctrl.init());
  });

  // ── Active-view ▾ menu (fixed-position popover, anchored to the caret) ──
  let menuOpen = $state(false);
  let menuPos = $state({ top: 0, left: 0 });
  let caretEl = $state<HTMLButtonElement>();
  let menuEl = $state<HTMLDivElement>();
  const MENU_W = 176; // w-44

  function toggleMenu() {
    if (menuOpen) {
      menuOpen = false;
      return;
    }
    const r = caretEl?.getBoundingClientRect();
    if (r) menuPos = { top: r.bottom + 4, left: Math.min(r.left, window.innerWidth - MENU_W - 8) };
    menuOpen = true;
  }

  $effect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuEl && !menuEl.contains(t) && caretEl && !caretEl.contains(t)) menuOpen = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') menuOpen = false;
    };
    const close = () => (menuOpen = false);
    const timer = setTimeout(() => document.addEventListener('click', onClick), 0);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, true);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
    };
  });

  function promptNewView() {
    const name = window.prompt(s.namePrompt());
    if (name && name.trim()) run(ctrl.saveAs(name));
  }

  function renameActive() {
    menuOpen = false;
    const a = ctrl.activeView;
    if (!a) return;
    const name = window.prompt(s.renamePrompt(), a.name);
    if (name && name.trim()) run(ctrl.rename(a.id, name));
  }

  function deleteActive() {
    menuOpen = false;
    const a = ctrl.activeView;
    if (a && window.confirm(s.confirmDelete(a.name))) run(ctrl.remove(a.id));
  }

  function menuAction(fn: () => Promise<unknown> | void) {
    menuOpen = false;
    run(fn());
  }

  const menuItem =
    'block w-full rounded px-2 py-1.5 text-left text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-40 dark:text-zinc-300 dark:hover:bg-zinc-800';
  const tabBase =
    'flex shrink-0 max-w-[14rem] items-center gap-1 border-b-2 px-3 py-2 text-sm font-medium transition';
  const activeTab = 'border-indigo-500 text-indigo-600 dark:text-indigo-400';
  const inactiveTab =
    'border-transparent text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200';
</script>

<div class="flex items-center gap-2 border-b border-zinc-200 dark:border-zinc-800">
  <!-- Scrollable tab strip -->
  <div class="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
    {#each sortedViews as v (v.id)}
      {#if v.id === ctrl.activeId}
        <div class="{tabBase} {activeTab}" title={v.name}>
          <span class="truncate">{v.name}</span>
          {#if ctrl.isModified}<span class="text-amber-500" title="Unsaved changes">•</span>{/if}
          <button
            bind:this={caretEl}
            type="button"
            aria-label={s.actionsLabel()}
            onclick={toggleMenu}
            class="ml-0.5 rounded px-1 text-xs text-zinc-400 hover:bg-zinc-200 hover:text-zinc-600 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
          >▾</button>
        </div>
      {:else}
        <button
          type="button"
          title={v.name}
          onclick={() => run(ctrl.select(v.id))}
          class="{tabBase} {inactiveTab}"
        >
          <span class="truncate">{v.name}</span>
        </button>
      {/if}
    {/each}
  </div>

  <!-- Save / Reset surface as buttons when the active view is modified -->
  {#if ctrl.activeView && ctrl.isModified}
    <button type="button" onclick={() => ctrl.reset()}
      class="shrink-0 rounded-md px-3 py-1 text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200">{s.reset()}</button>
    <button type="button" onclick={() => run(ctrl.save())}
      class="shrink-0 rounded-md bg-indigo-600 px-3 py-1 text-sm font-medium text-white hover:bg-indigo-500">{s.save()}</button>
  {/if}

  <button
    type="button"
    onclick={promptNewView}
    class="shrink-0 rounded-md px-3 py-1.5 text-sm font-medium text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
  >{s.newView()}</button>

  {#if error}
    <span class="shrink-0 text-xs text-red-600 dark:text-red-400">{error}</span>
  {/if}
</div>

<!-- Active-view ▾ menu — fixed so the strip's overflow can't clip it -->
{#if menuOpen && ctrl.activeView}
  <div
    bind:this={menuEl}
    class="fixed z-30 w-44 rounded-lg border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
    style="top: {menuPos.top}px; left: {menuPos.left}px;"
  >
    <button type="button" class={menuItem} onclick={renameActive}>{s.rename()}</button>
    <button type="button" class={menuItem} onclick={() => menuAction(() => ctrl.duplicate(ctrl.activeView!.id))}>{s.duplicate()}</button>
    <button type="button" class={menuItem} disabled={ctrl.activeView.isDefault} onclick={() => menuAction(() => ctrl.setDefault(ctrl.activeView!.id))}>{s.setDefault()}</button>
    <button type="button" class="{menuItem} text-red-600 dark:text-red-400" onclick={deleteActive}>{s.remove()}</button>
  </div>
{/if}
