<script lang="ts">
  // Test harness: mounts exactly the effect the node page runs
  // (`syncDraftWith`), so the client-lane test exercises the real wiring
  // rather than a copy of it.
  import { syncDraftWith, type DraftNode, type PropertiesDraft } from '$lib/properties-draft.svelte';

  let { draft, node }: { draft: PropertiesDraft; node: DraftNode } = $props();
  syncDraftWith(draft, () => node);
</script>
