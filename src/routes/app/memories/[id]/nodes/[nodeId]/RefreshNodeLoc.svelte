<script lang="ts">
  import { onDestroy } from 'svelte';
  import { refreshedNodeLoc } from '$lib/create-node/refresh-node-loc';
  import { t } from '$lib/i18n/t';

  let { memoryId, nodeId, savedName, savedLoc, name, loc, disabled = false, onrefresh }: {
    memoryId: string; nodeId: string; savedName: string; savedLoc: string;
    name: string; loc: string; disabled?: boolean; onrefresh: (loc: string) => void;
  } = $props();
  let busy = $state(false);
  let error = $state('');
  const context = $derived(JSON.stringify([memoryId, nodeId, savedName, savedLoc, name, loc, disabled]));
  let alive = true;
  let active: { controller: AbortController; timer: ReturnType<typeof setTimeout> } | null = null;
  function stop() {
    if (!active) return;
    active.controller.abort(); clearTimeout(active.timer); active = null;
  }
  $effect(() => {
    void context;
    return () => { stop(); if (alive) { busy = false; error = ''; } };
  });
  onDestroy(() => { alive = false; stop(); });

  async function refresh() {
    if (disabled || busy || name === savedName) return;
    const key = context;
    const controller = new AbortController();
    const mine = { controller, timer: setTimeout(() => controller.abort(), 10_000) };
    active = mine; busy = true; error = '';
    try {
      const next = await refreshedNodeLoc(memoryId, nodeId, savedLoc, name, controller.signal);
      if (alive && active === mine && key === context && !controller.signal.aborted) onrefresh(next);
    } catch {
      if (alive && active === mine && key === context) error = t('node.meta.refresh-loc.failed', 'Could not check the new URN. Try Refresh again, or edit the URN before saving.');
    } finally {
      clearTimeout(mine.timer);
      if (active === mine) { active = null; if (alive && key === context) busy = false; }
    }
  }
</script>

<div class="min-w-0">
  {#if name !== savedName}
    <button type="button" data-testid="refresh-node-loc" aria-label={t('node.meta.refresh-loc.label', 'Refresh URN from name')}
      disabled={disabled || busy} onclick={refresh}
      class="rounded-md border border-zinc-300 px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
      {busy ? t('node.meta.refresh-loc.working', 'Refreshing…') : t('node.meta.refresh-loc.action', 'Refresh')}
    </button>
  {/if}
  <p role="alert" class="mt-1 empty:hidden text-xs text-red-700 dark:text-red-300" data-testid="refresh-node-loc-error">{error}</p>
</div>
