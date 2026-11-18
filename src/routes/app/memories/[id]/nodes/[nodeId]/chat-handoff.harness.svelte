<script lang="ts">
  // #1522 — deterministic model of a route handoff between two mounted pages.
  //
  // A real SvelteKit navigation has a window where the INCOMING page's
  // components have initialized while the OUTGOING page's teardown has not yet
  // released what it holds — the incoming ChatThread's `superForm()` runs
  // before the outgoing one's `onDestroy`. Whether that window opens depends
  // on kit-internal ordering the test lane cannot (and should not) reproduce.
  // This host makes the window explicit instead: `phase` steps 'a' →
  // 'overlap' → 'b', where 'overlap' is exactly that window — both pages
  // mounted at once under one page-store value. On main both send forms share
  // sendChatMessageSchema's shape-hash id, so the second registration logs
  // superforms' duplicate-id warning; with node-scoped ids the two never
  // collide in any phase.
  //
  // The two sides are generic: the node page ↔ full-screen chat page handoff,
  // or the same route at two different nodes (a same-route navigation, where
  // ChatThread persists on main). `setForm` mirrors what kit's `applyAction`
  // does to the surviving page after a LATE action result: the page's `form`
  // prop becomes the result's data. A phase toggle (b → a → b) remounts a
  // side, modeling a further navigation while that old action data is still
  // on the page.
  import type { Component } from 'svelte';
  let {
    a,
    b,
  }: {
    a: { comp: Component<Record<string, unknown>>; props: Record<string, unknown> };
    b: { comp: Component<Record<string, unknown>>; props: Record<string, unknown> };
  } = $props();

  let phase = $state<'a' | 'overlap' | 'b'>('a');
  let forms = $state<{ a: unknown; b: unknown }>({ a: null, b: null });
  export function setPhase(next: 'a' | 'overlap' | 'b') {
    phase = next;
  }
  export function setForm(side: 'a' | 'b', form: unknown) {
    forms[side] = form;
  }
</script>

{#if phase !== 'b'}
  <a.comp {...a.props} form={forms.a} />
{/if}
{#if phase !== 'a'}
  <b.comp {...b.props} form={forms.b} />
{/if}
