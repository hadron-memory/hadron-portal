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

  // Type badge: slightly darker tinted background, subtle contrast with value
  const typeBadge: Record<string, string> = {
    org: 'bg-zinc-300 text-zinc-700 dark:bg-zinc-600 dark:text-zinc-200',
    memory: 'bg-sky-200 text-sky-800 dark:bg-sky-800 dark:text-sky-200',
    agent: 'bg-teal-200 text-teal-800 dark:bg-teal-800 dark:text-teal-200',
    station: 'bg-amber-200 text-amber-800 dark:bg-amber-800 dark:text-amber-200',
    node: 'bg-slate-300 text-slate-700 dark:bg-slate-600 dark:text-slate-200',
  };

  function copy() {
    navigator.clipboard.writeText(fullUrn);
    copied = true;
    setTimeout(() => (copied = false), 2000);
  }
</script>

<span class="inline-flex items-center gap-1">
  <code class="inline-flex items-center overflow-hidden rounded font-mono text-xs leading-tight">
    {#if compact}
      <span class="bg-zinc-100 px-1.5 py-0.5 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300" title={fullUrn}>{lastSegment}</span>
    {:else}
      {#if displayType}
        <span class="px-1.5 py-0.5 font-medium {typeBadge[displayType] ?? typeBadge.org}">{displayType}:</span>
      {/if}
      <span class="bg-zinc-200 px-1.5 py-0.5 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200">{bareValue}</span>
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
