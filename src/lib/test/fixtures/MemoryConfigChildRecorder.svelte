<script lang="ts">
  import { onMount } from 'svelte';
  import { recordMemoryConfigDestroy, recordMemoryConfigMount } from '$lib/test/memory-config-lifecycle';

  let mountId = $state(0);
  let draft = $state('pristine');

  onMount(() => {
    mountId = recordMemoryConfigMount();
    return () => recordMemoryConfigDestroy(mountId);
  });
</script>

<button
  type="button"
  data-testid="memory-config-recorder"
  data-mount-id={mountId}
  data-draft={draft}
  onclick={() => { draft = 'edited'; }}
>recorder</button>
