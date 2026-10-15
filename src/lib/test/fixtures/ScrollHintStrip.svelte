<script lang="ts">
  // #1086 (Atilla's P2 on #1111): a tab strip shaped like the node page's —
  // STATIC buttons, each with its own `data-active`, not an {#each} — so a
  // test can switch the active tab the way a click does on the real route.
  import { scrollHint } from '$lib/scroll-hint';

  let { initial = 'content' }: { initial?: string } = $props();
  // svelte-ignore state_referenced_locally
  let active = $state(initial);
</script>

<div class="scroll-hint" use:scrollHint={active}>
  <button data-active={active === 'content' || undefined} onclick={() => (active = 'content')}>content</button>
  <button data-active={active === 'discussion' || undefined} onclick={() => (active = 'discussion')}>discussion</button>
  <button data-active={active === 'abstract' || undefined} onclick={() => (active = 'abstract')}>abstract</button>
  <button data-active={active === 'data' || undefined} onclick={() => (active = 'data')}>data</button>
  <button data-active={active === 'properties' || undefined} onclick={() => (active = 'properties')}>properties</button>
  <button data-active={active === 'flow' || undefined} onclick={() => (active = 'flow')}>flow</button>
  <button data-active={active === 'children' || undefined} onclick={() => (active = 'children')}>children</button>
  <button data-active={active === 'edges' || undefined} onclick={() => (active = 'edges')}>edges</button>
  <button data-active={active === 'settings' || undefined} onclick={() => (active = 'settings')}>settings</button>
</div>
