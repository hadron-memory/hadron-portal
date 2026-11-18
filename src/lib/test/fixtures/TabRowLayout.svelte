<script lang="ts">
  import { untrack } from 'svelte';
  import TabRow, { type TabRowItem } from '$lib/components/TabRow.svelte';
  let { mode, items, selected }: { mode: 'tabs' | 'links'; items: TabRowItem[]; selected: string } = $props();
  let active = $state(untrack(() => selected));
</script>
<TabRow {mode} {items} {active} label="Sections" onselect={(id) => active = id} />
{#if mode === 'tabs'}<div role="tabpanel" id="panel-{active}" aria-labelledby="tab-{active}" tabindex="0" class="mt-4 rounded border border-zinc-200 p-4 text-sm text-zinc-700 dark:border-zinc-700 dark:text-zinc-300">Selected: {active}</div>{/if}
