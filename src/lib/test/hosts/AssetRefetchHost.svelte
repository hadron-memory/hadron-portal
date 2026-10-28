<!--
  Test host: renders the table or the card from reactive state the test can
  replace, standing in for the page's refetch / navigation (#1131). Not shipped.
-->
<script lang="ts">
  import type { AssetSummary } from '$lib/api/assetUpload';
  import AssetTable from '$lib/components/assets/AssetTable.svelte';
  import NodeAssetCard from '$lib/components/assets/NodeAssetCard.svelte';

  let { kind, initial }: { kind: 'table' | 'card'; initial: AssetSummary[] } = $props();
  let assets = $state.raw<AssetSummary[]>(untrack(() => initial));
  import { untrack } from 'svelte';

  export function setAssets(next: AssetSummary[]) {
    assets = next;
  }
</script>

{#if kind === 'table'}
  <AssetTable {assets} showMemory={true} />
{:else if assets[0]}
  {#key assets[0].id}
    <NodeAssetCard asset={assets[0]} />
  {/key}
{/if}
