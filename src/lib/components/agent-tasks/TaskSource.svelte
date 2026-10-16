<!--
  portal#1052 — a task's `source` (design §4): a link when it is a URL, the
  URN chip when it is an `hrn:` reference, otherwise plain text.
-->
<script lang="ts">
  import Urn from '$lib/components/Urn.svelte';
  import { sourceKind } from '$lib/agent-tasks/status';

  let { source }: { source: string } = $props();
  const kind = $derived(sourceKind(source));
</script>

{#if kind === 'url'}
  <a href={source} rel="noopener noreferrer" target="_blank" class="truncate text-xs text-indigo-600 hover:underline dark:text-indigo-300">{source}</a>
{:else if kind === 'urn'}
  <span class="min-w-0"><Urn value={source} size={10} compact /></span>
{:else}
  <span class="truncate text-xs text-zinc-500 dark:text-zinc-400">{source}</span>
{/if}
