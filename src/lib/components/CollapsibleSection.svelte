<script lang="ts">
  import { untrack, type Snippet } from 'svelte';

  /**
   * A titled section the reader unfolds when they want it.
   *
   * The heading holds the toggle, so the title is the one name for the section (screen readers get the
   * heading and the expanded state together). The body mounts the first time the section opens and then
   * stays mounted while folded: a form half filled in, a pending write or a fresh row survives a collapse,
   * and a section nobody opens never mounts, so it never costs a read.
   */
  let { id, title, open = $bindable(false), onopen, children }: {
    /** Stable, unique on the page: it names the toggle and the region, and is the `?section=` value. */
    id: string;
    title: string;
    open?: boolean;
    /** Fires each time the section goes from folded to open. */
    onopen?: () => void;
    children: Snippet;
  } = $props();

  // A section that starts open renders its body on the first paint (a link naming it, server rendering).
  let everOpened = $state(untrack(() => open));
  // Opened by the page too (a link naming this section), not only by the toggle.
  $effect(() => { if (open) everOpened = true; });

  function toggle() {
    open = !open;
    if (open) onopen?.();
  }
</script>

<section data-section={id} class="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
  <h2 class="m-0">
    <button
      type="button"
      id="section-{id}-toggle"
      aria-expanded={open}
      aria-controls="section-{id}-body"
      onclick={toggle}
      class="flex w-full items-center justify-between gap-3 rounded-xl px-5 py-4 text-left font-semibold text-zinc-900 hover:bg-zinc-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-indigo-500 dark:text-white dark:hover:bg-zinc-800/60"
    >
      <span>{title}</span>
      <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" class="h-5 w-5 shrink-0 text-zinc-500 transition-transform dark:text-zinc-400 {open ? 'rotate-180' : ''}">
        <path fill-rule="evenodd" d="M5.22 7.22a.75.75 0 0 1 1.06 0L10 10.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 8.28a.75.75 0 0 1 0-1.06Z" clip-rule="evenodd" />
      </svg>
    </button>
  </h2>
  <div id="section-{id}-body" role="region" aria-labelledby="section-{id}-toggle" hidden={!open} class="border-t border-zinc-200 px-5 py-5 dark:border-zinc-800">
    {#if everOpened}{@render children()}{/if}
  </div>
</section>
