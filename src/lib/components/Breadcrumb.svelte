<script lang="ts">
  interface Crumb {
    label: string;
    href?: string;
  }

  let { items }: { items: Crumb[] } = $props();
</script>

<nav class="flex items-center gap-1 text-sm flex-wrap">
  {#each items as item, i}
    {#if i > 0}
      <span class="text-zinc-400">/</span>
    {/if}
    {#if item.href && i < items.length - 1}
      <a href={item.href} class="text-indigo-500 hover:underline dark:text-indigo-400">{item.label}</a>
    {:else}
      <span class="text-zinc-700 dark:text-zinc-300">{item.label}</span>
    {/if}
  {/each}
</nav>
