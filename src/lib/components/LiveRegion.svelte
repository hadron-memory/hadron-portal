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

  A call site may pass `data-*` attributes (e.g. `data-testid`) so a test can select this exact
  region; role and aria-live cannot be overridden.

  The wrapper carries no styling of its own, so an idle region draws nothing. It
  also drops its margin while idle (`idle:m-0`), so a `space-y-*` parent does
  not leave a blank gap where it sits. "Idle" is `:empty` OR the `data-idle`
  attribute this component keeps from its content (no element child and no
  visible text): a text node between two sibling blocks breaks `:empty` and
  nothing else (portal#2394). Use `idle:` (and `last:idle:`) rather than
  `empty:` on a call site. A flex/grid `gap` parent still counts it as an
  item: put the region outside that row rather than inside it.

  A region whose host MOUNTS and starts its read in the same step (a panel opened on a click, a
  section mounted unread) would otherwise be inserted already holding its text, and a screen reader
  may not announce text that is present when a region is first registered. Pass `deferFirst` there: the
  region is inserted EMPTY and takes its content after the first paint of the frame it was inserted in,
  so the first read is a change inside a region that already exists (portal#2388). It is opt-in: a
  region whose text is already visible content at mount (an error shown on load) must not wait.
  The wrapper is in the DOM, and as tall as when idle, from the first frame, so layout does not move.

  Convention: hrn:node:hadronmemory.com:hadron-portal:components:live-region
  Check: hrn:node:hadronmemory.com:hadron-portal:review:live-region-persistent-not-conditionally-mounted
-->
<script lang="ts">
  import { onMount, untrack, type Snippet } from 'svelte';

  let {
    children,
    class: className = '',
    id,
    deferFirst = false,
    ...rest
  }: { children?: Snippet; class?: string; id?: string; deferFirst?: boolean; [attr: `data-${string}`]: string | undefined } = $props();

  let el = $state<HTMLElement>();
  // portal#2388: with `deferFirst` the content is withheld until after the first paint. Read once, at mount.
  let filled = $state(untrack(() => !deferFirst));
  onMount(() => {
    if (filled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const fill = () => { timer = setTimeout(() => { filled = true; }, 0); };
    const frame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fill) : undefined;
    if (frame === undefined) fill();
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  });

  // Idle = no element child and no visible text. Kept from the content because `:empty` does not hold
  // when a whitespace text node sits between two blocks (portal#2394). Server-rendered markup is
  // comment-only, so `:empty` covers the first paint and this takes over once mounted.
  $effect(() => {
    const node = el;
    if (!node) return;
    const sync = () => node.toggleAttribute('data-idle', node.childElementCount === 0 && !(node.textContent ?? '').trim());
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(node, { childList: true, characterData: true, subtree: true });
    return () => observer.disconnect();
  });
</script>

<div bind:this={el} {...rest} role="status" aria-live="polite" {id} class="idle:m-0 {className}">{#if filled}{@render children?.()}{/if}</div>
