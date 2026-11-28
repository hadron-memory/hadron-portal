<script lang="ts">
  import TableFrame from '$lib/components/table/TableFrame.svelte';
  let { showSearch, showViews }: { showSearch?: boolean; showViews?: boolean } = $props();
</script>

<TableFrame {showSearch} {showViews}>
  {#snippet controls()}<span>controls</span>{/snippet}
  <p>table</p>
</TableFrame>
