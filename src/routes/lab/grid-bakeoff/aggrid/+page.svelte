<script lang="ts">
  import NodeListAgGrid from '$lib/components/spike/NodeListAgGrid.svelte';
  import { mockNodes } from '../mockNodes';
</script>

<h1 class="mb-4 text-xl font-bold">Bake-off: AG Grid Community</h1>
<NodeListAgGrid nodes={mockNodes} basePath="/app/memories/mem-1" />
