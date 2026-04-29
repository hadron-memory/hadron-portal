<script lang="ts">
  type UrnType = 'org' | 'memory' | 'agent' | 'app' | 'node';

  let { value, type, size = 12, compact = false }: {
    value: string;
    type?: UrnType;
    size?: number;
    compact?: boolean;
  } = $props();

  let copied = $state(false);

  // Auto-detect type from urn: prefix if present
  const parsed = $derived.by(() => {
    const match = value.match(/^urn:(org|memory|agent|app|node):(.+)$/);
    if (match) return { type: match[1] as UrnType, bare: match[2] };
    return { type: type ?? null, bare: value };
  });

  const displayType = $derived(parsed.type);
  const bareValue = $derived(parsed.bare);
  const fullUrn = $derived(displayType ? `urn:${displayType}:${bareValue}` : bareValue);
  const lastSegment = $derived(bareValue.split(':').pop() ?? bareValue);

  // Type badge: uniform style across all types
  const typeBadgeClass = 'bg-slate-300 text-slate-700 dark:bg-slate-600 dark:text-slate-200';

  function copy() {
    navigator.clipboard.writeText(fullUrn);
    copied = true;
    setTimeout(() => (copied = false), 2000);
  }
</script>

<span class="inline-flex items-center gap-1">
  <code class="inline-flex items-center overflow-hidden rounded font-mono leading-tight" style="font-size: 0.6rem;">
    {#if compact}
      <span class="bg-zinc-100 px-1.5 py-0.5 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300" title={fullUrn}>{lastSegment}</span>
    {:else}
      {#if displayType}
        <span class="pl-1.5 pr-0.5 py-0.5 font-medium {typeBadgeClass}">{displayType}:</span>
      {/if}
      <span class="bg-zinc-200 pl-0.5 pr-1.5 py-0.5 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200">{bareValue}</span>
    {/if}
  </code>
  <button onclick={copy} class="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300" title="Copy URN">
    {#if copied}
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
    {:else}
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
    {/if}
  </button>
</span>
