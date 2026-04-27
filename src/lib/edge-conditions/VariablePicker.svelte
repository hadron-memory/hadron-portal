<script lang="ts">
  import { t } from '$lib/i18n/t';
  import { KNOWN_VARIABLES, labelFor } from './known-variables.js';

  let { value = $bindable(''), placeholder = '' }: { value?: string; placeholder?: string } = $props();

  const friendlyLabel = $derived(labelFor(value));

  // datalist needs a stable id when there are multiple instances mounted.
  const listId = `vp-${Math.random().toString(36).slice(2, 9)}`;
</script>

<div class="flex flex-col gap-0.5">
  <input
    type="text"
    bind:value
    list={listId}
    placeholder={placeholder || t('edge-conditions.builder.variable.placeholder', 'memory.business_type')}
    class="rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
  />
  <datalist id={listId}>
    {#each KNOWN_VARIABLES as v (v.path)}
      <option value={v.path}>{v.label}</option>
    {/each}
  </datalist>
  {#if friendlyLabel}
    <span class="text-[10px] text-zinc-500">{friendlyLabel}</span>
  {/if}
</div>
