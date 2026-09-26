<script lang="ts">
  // Test harness for #931: renders `draft.dirty` into the DOM the way the node
  // page's Save button reads it, and seeds on `open` in an effect, after the
  // first render, as the page does. A reactivity gap in `dirty` only shows up
  // through a rendered template; reading the getter directly always "works".
  import { untrack } from 'svelte';
  import { syncTextDraftWith, type TextDraft, type TextDraftSource } from '$lib/text-draft.svelte';

  let { draft, node, open }: { draft: TextDraft; node: TextDraftSource; open: boolean } = $props();
  const d = untrack(() => draft);
  syncTextDraftWith(d, () => node);
  $effect(() => {
    if (open) untrack(() => d.ensureSeeded());
  });
</script>

{#if open}
  <textarea data-testid="editor" bind:value={d.text}></textarea>
  <button data-testid="save" disabled={!d.dirty}>Save</button>
{/if}
