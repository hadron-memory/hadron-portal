<script lang="ts">
  import Urn from '$lib/components/Urn.svelte';
  import { parseUrnV2 } from '$lib/urn/parse-urn';
  import { describeWarning } from '$lib/memory-config/warnings';
  import type { MemoryConfigWarning } from '$lib/memory-config/types';
  // Advisories from a save or apply: a task a rule points at may not be readable by everyone who reads the memory.
  // The URN is only ever the one the server returned; nothing here builds or looks up a task.
  let { warnings }: { warnings: MemoryConfigWarning[] } = $props();
  // The Urn chip re-composes what it is given and prefixes a type it guesses, so only a value
  // that already is a v2 URN goes through it. Anything else is repeated as the server sent it.
  function isUrn(value: string) { try { parseUrnV2(value); return true; } catch { return false; } }
</script>
{#each warnings as warning}
  {@const described = describeWarning(warning)}
  <div data-task-warning class="border-l-2 border-amber-500 pl-3 text-amber-900 dark:text-amber-200">
    <p class="break-words">{described.text}</p>
    {#if described.urn}<div class="mt-1">{#if isUrn(described.urn)}<Urn value={described.urn} copyUrl={false} />{:else}<code class="font-mono text-xs break-all">{described.urn}</code>{/if}</div>{/if}
  </div>
{/each}
