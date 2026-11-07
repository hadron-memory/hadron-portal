<script lang="ts">
  import MemoryConfigChildRecorder from './MemoryConfigChildRecorder.svelte';
  let { data }: { data: { principalScope: string } } = $props();
</script>

<div data-principal-scope={data.principalScope}><MemoryConfigChildRecorder /></div>
