<script lang="ts">
  let { value, size = 12 }: { value: string; size?: number } = $props();
  let copied = $state(false);

  function copy() {
    navigator.clipboard.writeText(value);
    copied = true;
    setTimeout(() => (copied = false), 2000);
  }
</script>

<span class="inline-flex items-center gap-1">
  <code class="font-mono text-xs text-zinc-400">{value}</code>
  <button onclick={copy} class="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300" title="Copy URN">
    {#if copied}
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
    {:else}
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
    {/if}
  </button>
</span>
