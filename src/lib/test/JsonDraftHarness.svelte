<script lang="ts">
  // Test harness: mounts exactly the effect the node page runs
  // (`syncDraftWith`), so the client-lane test exercises the real wiring
  // rather than a copy of it.
  import { untrack } from 'svelte';
  import { syncDraftWith, type DraftSource, type JsonDraft } from '$lib/json-draft.svelte';

  let { draft, node }: { draft: JsonDraft; node: DraftSource } = $props();
  // The draft INSTANCE is fixed for the harness's life — as the page's `const`
  // is — so it is read once, deliberately; the node is read live.
  syncDraftWith(untrack(() => draft), () => node);
</script>
