<script lang="ts">
  // #636: shared chrome for every dashboard widget so slots look consistent.
  // Title header + a body rendered from the widget's own markup.
  import type { Snippet } from 'svelte';

  let { title, children }: { title: string; children: Snippet } = $props();
</script>

<section
  class="flex h-full flex-col rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900"
>
  <h3 class="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
    {title}
  </h3>
  <div class="flex-1">
    {@render children()}
  </div>
</section>
