<script lang="ts">
  // GitHub-style saved-views tab strip (spec 020 follow-up). A horizontal,
  // scrollable strip of view tabs over the shared viewController; the active
  // view's edit menu lives just RIGHT of the strip (a dropdown inside the
  // overflow-x-auto strip would be clipped). Replaces the old dropdown picker.
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

  // ── Active-view actions menu ──────────────────────────────────────────
  let menuOpen = $state(false);
  let menuEl = $state<HTMLDetailsElement>();
  $effect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (menuEl && !menuEl.contains(e.target as Node)) menuOpen = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') menuOpen = false;
    };
    const timer = setTimeout(() => document.addEventListener('click', onClick), 0);
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
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
    'flex shrink-0 max-w-[12rem] items-center gap-1 truncate border-b-2 px-3 py-2 text-sm font-medium transition';
</script>

<div class="flex items-center gap-2 border-b border-zinc-200 dark:border-zinc-800">
  <!-- Scrollable tab strip -->
  <div class="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
    {#each sortedViews as v (v.id)}
      <button
        type="button"
        title={v.name}
        onclick={() => v.id !== ctrl.activeId && run(ctrl.select(v.id))}
        class="{tabBase} {v.id === ctrl.activeId
          ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
          : 'border-transparent text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200'}"
      >
        {#if v.isDefault}<span class="text-amber-500" aria-label="Default">★</span>{/if}
        <span class="truncate">{v.name}</span>
        {#if v.id === ctrl.activeId && ctrl.isModified}<span class="text-amber-500" title="Unsaved changes">•</span>{/if}
      </button>
    {/each}
  </div>

  <!-- Active-view actions menu (kept outside the scroll strip so it isn't clipped) -->
  {#if ctrl.activeView}
    <details bind:this={menuEl} bind:open={menuOpen} class="relative shrink-0">
      <summary
        aria-label={s.actionsLabel()}
        class="cursor-pointer list-none rounded-md border border-zinc-300 bg-zinc-100 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-200 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
      >▾</summary>
      <div class="absolute right-0 z-20 mt-1 w-44 rounded-lg border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
        {#if ctrl.isModified}
          <button type="button" class={menuItem} onclick={() => menuAction(() => ctrl.save())}>{s.save()}</button>
          <button type="button" class={menuItem} onclick={() => menuAction(() => ctrl.reset())}>{s.reset()}</button>
        {/if}
        <button type="button" class={menuItem} onclick={renameActive}>{s.rename()}</button>
        <button type="button" class={menuItem} onclick={() => menuAction(() => ctrl.duplicate(ctrl.activeView!.id))}>{s.duplicate()}</button>
        <button type="button" class={menuItem} disabled={ctrl.activeView.isDefault} onclick={() => menuAction(() => ctrl.setDefault(ctrl.activeView!.id))}>{s.setDefault()}</button>
        <button type="button" class="{menuItem} text-red-600 dark:text-red-400" onclick={deleteActive}>{s.remove()}</button>
      </div>
    </details>
  {/if}

  <button
    type="button"
    onclick={promptNewView}
    class="shrink-0 rounded-md px-3 py-1.5 text-xs font-medium text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
  >{s.newView()}</button>

  {#if error}
    <span class="shrink-0 text-xs text-red-600 dark:text-red-400">{error}</span>
  {/if}
</div>
