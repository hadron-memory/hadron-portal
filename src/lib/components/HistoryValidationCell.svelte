<!--
  #1724 — a History row's Validation cell: the advisory badge, and under it what
  the row's report says (when, task revision, author check). A revision with no
  report shows the badge alone.
-->
<script lang="ts">
  import { validationHistoryDetail, type ValidationView } from '$lib/node-provenance';
  import NodeValidationBadge from './NodeValidationBadge.svelte';

  let { view }: { view: ValidationView } = $props();

  const detail = $derived(validationHistoryDetail(view));
</script>

<NodeValidationBadge {view} compact />
{#if detail}
  <div data-testid="history-validation-detail" class="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{detail}</div>
{/if}
