<script lang="ts">
  import Urn from '$lib/components/Urn.svelte';
  import { t } from '$lib/i18n/t';
  import { isFlatV2 } from '$lib/urn/parse-urn';
  import { describeWarning, fieldWords } from '$lib/memory-config/warnings';
  import type { MemoryConfigWarning } from '$lib/memory-config/types';
  // Advisories from a save or apply: a task a rule points at may not be readable by everyone who reads the memory.
  // The URN is only ever the one the server returned; nothing here builds or looks up a task.
  let { warnings }: { warnings: MemoryConfigWarning[] } = $props();
  // The Urn chip re-composes what it is given and prefixes a type it guesses, so only a value
  // that already is a v2 URN goes through it. Anything else is repeated as the server sent it.
  function isUrn(value: string) { return isFlatV2(value); }
  function urnLabel(warning: MemoryConfigWarning) {
    const field = fieldWords(warning.field ?? null) ?? t('config.warning.field.task', 'task');
    const role = warning.role || t('config.warning.unnamed-role', 'unnamed role');
    return t('config.warning.urn-label', '{field} for “{role}”', { field, role });
  }
</script>
{#each warnings as warning}
  {@const described = describeWarning(warning)}
  <div data-task-warning class="border-l-2 border-amber-500 pl-3 text-amber-900 dark:text-amber-200">
    <p class="break-words">{described.text}</p>
    {#if described.urn}<div class="mt-1">{#if isUrn(described.urn)}<Urn value={described.urn} copyUrl={false} label={urnLabel(warning)} />{:else}<code class="font-mono text-xs break-all">{described.urn}</code>{/if}</div>{/if}
  </div>
{/each}
