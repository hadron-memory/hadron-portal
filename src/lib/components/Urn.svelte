<script lang="ts">
  type UrnType = 'org' | 'memory' | 'agent' | 'station' | 'node';

  let { value, type, size = 12, compact = false }: {
    value: string;
    type?: UrnType;
    size?: number;
    compact?: boolean;
  } = $props();

  let copied = $state(false);

  // Auto-detect type from urn: prefix if present
  const parsed = $derived.by(() => {
    const match = value.match(/^urn:(org|memory|agent|station|node):(.+)$/);
    if (match) return { type: match[1] as UrnType, bare: match[2] };
    return { type: type ?? null, bare: value };
  });

  const displayType = $derived(parsed.type);
  const bareValue = $derived(parsed.bare);
  const fullUrn = $derived(displayType ? `urn:${displayType}:${bareValue}` : bareValue);
  const lastSegment = $derived(bareValue.split(':').pop() ?? bareValue);

  // Type-specific accent for the prefix portion
  const typeColor: Record<string, string> = {
    org: 'text-zinc-500 dark:text-zinc-400',
    memory: 'text-blue-600 dark:text-blue-400',
    agent: 'text-purple-600 dark:text-purple-400',
    station: 'text-green-600 dark:text-green-400',
    node: 'text-indigo-600 dark:text-indigo-400',
  };

  function copy() {
    navigator.clipboard.writeText(fullUrn);
    copied = true;
    setTimeout(() => (copied = false), 2000);
  }
</script>

<span class="inline-flex items-center gap-1">
  <code class="inline-flex items-center rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-xs leading-tight dark:bg-zinc-800">
    {#if compact}
      <span class="text-zinc-600 dark:text-zinc-300" title={fullUrn}>{lastSegment}</span>
    {:else}
      {#if displayType}
        <span class="{typeColor[displayType] ?? typeColor.org} font-medium">{displayType}:</span>
      {/if}
      <span class="text-zinc-600 dark:text-zinc-300">{bareValue}</span>
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
