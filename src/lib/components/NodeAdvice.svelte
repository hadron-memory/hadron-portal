<script lang="ts">
  import { untrack } from 'svelte';
  import { t } from '$lib/i18n/t';
  let { advice }: { advice: string[] } = $props();
  let box = $state<HTMLElement | null>(null);

  // An enhanced save's invalidateAll delivers new advice to a page the reader
  // may have scrolled far down. Only that arrival scrolls, never the first
  // load; `nearest` is a no-op when the box is already in view, and focus stays put.
  const firstLoad = untrack(() => advice);
  $effect(() => {
    if (advice !== firstLoad && advice.length) box?.scrollIntoView?.({ block: 'nearest' });
  });
</script>

<!-- #1371 (Uma, #49203): the region is always mounted, so advice an enhanced
     save inserts is announced. A full page load server-renders the box inside
     it as ordinary page content, which also keeps it readable without JS. -->
<div role="status">
  {#if advice.length}
    <div bind:this={box} class="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200" data-testid="node-save-advice">
      <p class="font-semibold">{t('node.save.advice.title', 'Advice from a saved change')}</p>
      {#each advice as text}<p class="mt-1">{text}</p>{/each}
    </div>
  {/if}
</div>
