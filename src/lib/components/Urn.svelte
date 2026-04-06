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

  // Split segments for visual rendering
  const segments = $derived(bareValue.split(':'));
  const lastSegment = $derived(segments[segments.length - 1]);

  // Type badge colors
  const badgeClass: Record<string, string> = {
    org: 'bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300',
    memory: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
    agent: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
    station: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
    node: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300',
  };

  function copy() {
    navigator.clipboard.writeText(fullUrn);
    copied = true;
    setTimeout(() => (copied = false), 2000);
  }
</script>

<span class="inline-flex items-center gap-1">
  {#if displayType}
    <span class="rounded px-1 py-0.5 font-mono text-[10px] font-medium leading-none {badgeClass[displayType] ?? badgeClass.org}">{displayType}</span>
  {/if}
  {#if compact}
    <code class="font-mono text-xs text-zinc-500 dark:text-zinc-400" title={fullUrn}>{lastSegment}</code>
  {:else}
    <code class="font-mono text-xs">
      {#each segments as seg, i}
        {#if i > 0}<span class="text-zinc-300 dark:text-zinc-600">:</span>{/if}
        {#if displayType === 'node' && i < 2}
          <span class="text-zinc-400 dark:text-zinc-500">{seg}</span>
        {:else if i < segments.length - 1}
          <span class="text-zinc-400 dark:text-zinc-500">{seg}</span>
        {:else}
          <span class="text-zinc-600 dark:text-zinc-300">{seg}</span>
        {/if}
      {/each}
    </code>
  {/if}
  <button onclick={copy} class="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300" title="Copy {displayType ? `urn:${displayType}:` : ''}{bareValue}">
    {#if copied}
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
    {:else}
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
    {/if}
  </button>
</span>
