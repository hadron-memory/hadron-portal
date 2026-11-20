<!--
  A persistent live region (portal#2344).

  Screen readers announce a CHANGE inside a live region that already exists; a
  region inserted into the DOM already populated is not reliably announced, and
  one that unmounts says nothing. So the region itself is always mounted and
  only its CONTENT comes and goes. Put the visible, styled box INSIDE it:

    <LiveRegion>
      {#if saved}<div class="rounded-lg border ...">{saved}</div>{/if}
    </LiveRegion>

  not `{#if saved}<div role="status" class="rounded-lg border ...">…</div>{/if}`.

  The wrapper carries no styling of its own, so an idle region draws nothing. It
  also drops its margin while empty (`empty:m-0`), so a `space-y-*` parent does
  not leave a blank gap where it sits. A flex/grid `gap` parent still counts it
  as an item: put the region outside that row rather than inside it.

  Convention: hrn:node:hadronmemory.com:hadron-portal:components:live-region
  Check: hrn:node:hadronmemory.com:hadron-portal:review:live-region-persistent-not-conditionally-mounted
-->
<script lang="ts">
  import type { Snippet } from 'svelte';

  let { children, class: className = '', id }: { children?: Snippet; class?: string; id?: string } = $props();
</script>

<div role="status" aria-live="polite" {id} class="empty:m-0 {className}">{@render children?.()}</div>
