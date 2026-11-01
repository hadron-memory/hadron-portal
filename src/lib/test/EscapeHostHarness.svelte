<!--
  #1584 red-pin host: a dialog-shaped panel with the PRE-#1582 Escape pattern
  (a window-level BUBBLE listener), hosting a picker as its content. The
  listener registers at HOST mount — before any listener the picker child
  registers — which is the exact ordering that let one Escape close two
  layers at once (hrn:node:hadronmemory.com:hadron-portal:findings:dialog-escape-consumed-at-its-layer).
  The child is passed as a prop so one harness serves every picker under test.
-->
<script lang="ts">
  import type { Component } from 'svelte';
  let {
    child,
    childProps = {},
  }: {
    // Any picker: each requires its own props (agents, orgs, search…), which
    // arrive via `childProps`, so the constraint here is deliberately loose —
    // `any` props, or svelte-check demands this exact component's props.
    child: Component<any, any, string>;
    childProps?: Record<string, unknown>;
  } = $props();

  let open = $state(true);
  let escapes = $state(0);

  function onWindowEscape(e: KeyboardEvent) {
    if (!open || e.key !== 'Escape') return;
    escapes++;
    open = false;
  }

  export function hostEscapes() {
    return escapes;
  }
</script>

<svelte:window onkeydown={onWindowEscape} />

{#if open}
  {@const Child = child}
  <div role="dialog" aria-modal="true" aria-label="Host panel" data-host-dialog>
    <Child {...childProps} />
  </div>
{/if}
