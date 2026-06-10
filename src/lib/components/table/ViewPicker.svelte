<script lang="ts">
  // Reusable saved-views picker (spec 020). List-agnostic: depends only on a
  // grid `table` instance, an opaque `listKey`, and a `ViewStore`. All strings
  // route through t() (Principle III). The logic lives in createViewController.
  import { onMount } from 'svelte';
  import type { Table } from '@tanstack/table-core';
  import { createViewController } from '$lib/table/viewController.svelte';
  import { localStorageViewStore } from '$lib/table/localStorageViewStore';
  import type { ViewStore } from '$lib/table/viewStore';
  import { savedViewsStrings as s } from '$lib/i18n/saved-views-strings';

  let {
    table,
    listKey,
    store = localStorageViewStore,
  }: { table: Table<any>; listKey: string; store?: ViewStore } = $props();

  const ctrl = createViewController({ table, listKey, store });

  onMount(() => {
    ctrl.init();
  });

  function promptSaveAs() {
    const name = window.prompt(s.namePrompt());
    if (name && name.trim()) ctrl.saveAs(name);
  }

  function promptRename(id: string, current: string) {
    const name = window.prompt(s.renamePrompt(), current);
    if (name && name.trim()) ctrl.rename(id, name);
  }

  function confirmRemove(id: string, name: string) {
    if (window.confirm(s.confirmDelete(name))) ctrl.remove(id);
  }

  const btn =
    'rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100 disabled:opacity-40 disabled:cursor-not-allowed dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800';
</script>

<div class="flex flex-wrap items-center gap-2">
  {#if ctrl.views.length === 0}
    <button type="button" class={btn} onclick={promptSaveAs}>{s.saveCurrentAs()}</button>
  {:else}
    <label class="flex items-center gap-1 text-xs text-zinc-500">
      {s.viewsLabel()}
      <select
        value={ctrl.activeId ?? ''}
        onchange={(e) => {
          const v = (e.target as HTMLSelectElement).value;
          if (v) ctrl.select(v);
        }}
        class="rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
      >
        {#if ctrl.activeId === null}
          <option value="" disabled selected>—</option>
        {/if}
        {#each ctrl.views as v (v.id)}
          <option value={v.id}>{v.name}{v.isDefault ? ` (${s.defaultBadge()})` : ''}</option>
        {/each}
      </select>
    </label>

    {#if ctrl.isModified}
      <span class="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300">{s.modifiedBadge()}</span>
    {/if}

    <button type="button" class={btn} disabled={!ctrl.activeView || !ctrl.isModified} onclick={() => ctrl.save()}>{s.save()}</button>
    <button type="button" class={btn} disabled={!ctrl.isModified} onclick={() => ctrl.reset()}>{s.reset()}</button>
    <button type="button" class={btn} onclick={promptSaveAs}>{s.saveAs()}</button>
    {#if ctrl.activeView}
      <button type="button" class={btn} disabled={ctrl.activeView.isDefault} onclick={() => ctrl.activeView && ctrl.setDefault(ctrl.activeView.id)}>{s.setDefault()}</button>
      <button type="button" class={btn} onclick={() => ctrl.activeView && promptRename(ctrl.activeView.id, ctrl.activeView.name)}>{s.rename()}</button>
      <button type="button" class={btn} onclick={() => ctrl.activeView && confirmRemove(ctrl.activeView.id, ctrl.activeView.name)}>{s.remove()}</button>
    {/if}
  {/if}
</div>
