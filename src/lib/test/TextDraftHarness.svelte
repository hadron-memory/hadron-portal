<script lang="ts">
  // Test harness: mounts exactly the effect the node page runs
  // (`syncTextDraftWith`), as JsonDraftHarness does for the JSON drafts.
  import { untrack } from 'svelte';
  import { syncTextDraftWith, type TextDraft, type TextDraftSource } from '$lib/text-draft.svelte';

  let { draft, node }: { draft: TextDraft; node: TextDraftSource } = $props();
  syncTextDraftWith(untrack(() => draft), () => node);
</script>
