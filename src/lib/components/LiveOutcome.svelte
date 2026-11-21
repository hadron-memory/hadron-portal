<!--
  An outcome that is a status when it succeeds and an alert when it fails (portal#2379, slice of #2344).

  `role={failed ? 'alert' : 'status'}` on the conditional element inserts the status half already
  populated, so it may not be announced, and a live region's role changed in place is not announced
  reliably either. So there are TWO regions, both always mounted: a polite `status` and an `alert`.
  The caller's content goes into whichever one matches `failed`; the other stays empty. The styled
  box is the caller's, inside:

    <LiveOutcome failed={note?.failed ?? false}>
      {#if note}<p class="rounded-lg border ...">{note.text}</p>{/if}
    </LiveOutcome>

  Both wrappers carry no styling and drop their margin while empty (`empty:m-0`), as `LiveRegion`
  does. They are two siblings, so a flex/grid `gap` parent counts two empty items: put the outcome
  outside that row. In a `space-y-*` parent the status region is not the last child (the alert
  region follows it), so it would gain a trailing gap the old last-child box never had; the
  `:has` class drops that margin when only the empty alert region follows.

  Placement (hadron-portal#2386 ruling): never an idle region as the LAST child of a `space-y-*` parent
  or last item of a flex/grid `gap` row, because the element before it stops being the last child and
  gains its spacing. Put it right AFTER the container, or in a plain wrapper `<div>`, with the old top
  margin (`mt-3`) on the box.

  Convention: hrn:node:hadronmemory.com:hadron-portal:components:live-region
  Check: hrn:node:hadronmemory.com:hadron-portal:review:live-region-persistent-not-conditionally-mounted
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import LiveRegion from './LiveRegion.svelte';

  let { failed, children, class: className = '' }: { failed: boolean; children?: Snippet; class?: string } = $props();
</script>

<LiveRegion class="[&:has(+_:last-child:empty)]:mb-0 {className}">{#if !failed}{@render children?.()}{/if}</LiveRegion>
<div role="alert" class="empty:m-0 {className}">{#if failed}{@render children?.()}{/if}</div>
