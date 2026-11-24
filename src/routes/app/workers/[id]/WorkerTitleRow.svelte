<script lang="ts">
  import type { Snippet } from 'svelte';

  /**
   * The worker detail header row: the name as the page's one H1, then whatever
   * sits beside it (status badge, actions menu).
   *
   * portal#2564 — a name is unbounded and a 64-character one has no break
   * opportunity, so its min-content width set the page's width and dragged the
   * whole page sideways on a phone. `min-w-0` lets the heading shrink inside
   * the flex row and `break-words` (overflow-wrap:anywhere would also do) wraps
   * it, so the full name stays readable rather than being cut.
   */
  let { name, children }: { name: string; children?: Snippet } = $props();
</script>

<div class="mt-2 flex flex-wrap items-center gap-3" data-testid="worker-title-row">
  <h1 class="max-w-full min-w-0 text-2xl font-bold [overflow-wrap:anywhere] text-zinc-900 dark:text-white">{name}</h1>
  {@render children?.()}
</div>
