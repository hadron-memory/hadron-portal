<script lang="ts">
  import TableFrame from '$lib/components/table/TableFrame.svelte';
  let { showSearch }: { showSearch?: boolean } = $props();
</script>

<TableFrame {showSearch}>
  {#snippet controls()}<span>controls</span>{/snippet}
  <p>table</p>
</TableFrame>
