<script lang="ts">
  import NodeListTanstack from '$lib/components/spike/NodeListTanstack.svelte';
  import { mockNodes } from '../mockNodes';
</script>

<h1 class="mb-4 text-xl font-bold">Bake-off: TanStack table-core</h1>
<NodeListTanstack nodes={mockNodes} basePath="/app/memories/mem-1" />
