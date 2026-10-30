<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { t } from '$lib/i18n/t';
  let { advice }: { advice: string[] } = $props();
  let box = $state<HTMLElement | null>(null);

  // #1371 (Uma): fill after mount, never in the server render, so even
  // first-load advice is an insertion into the live region below, which is what
  // a screen reader announces.
  let mounted = $state(false);
  onMount(() => { mounted = true; });
  const shown = $derived(mounted ? advice : []);

  // An enhanced save's invalidateAll delivers new advice to a page the reader
  // may have scrolled far down. Only that arrival scrolls, never the first
  // load; `nearest` is a no-op when the box is already in view, and focus stays put.
  const firstLoad = untrack(() => advice);
  $effect(() => {
    if (advice !== firstLoad && shown.length) box?.scrollIntoView?.({ block: 'nearest' });
  });
</script>

<div role="status">
  {#if shown.length}
    <div bind:this={box} class="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200" data-testid="node-save-advice">
      <p class="font-semibold">{t('node.save.advice.title', 'Advice from a saved change')}</p>
      {#each shown as text}<p class="mt-1">{text}</p>{/each}
    </div>
  {/if}
</div>
