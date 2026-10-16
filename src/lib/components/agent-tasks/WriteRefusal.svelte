<!--
  portal#1090 — a refused or uncertain task write (design §5). A typed
  refusal shows the server's sentence verbatim, framed by "Not changed" and
  its code (the sentence itself is deliberately not translated: it is the
  server's). Anything else shows the fixed uncertainty line, never raw
  internals and never "failed". Text carries the meaning, not colour.
-->
<script lang="ts">
  import { WRITE_UNCERTAIN_TEXT, writeLead, type WriteRefusal } from '$lib/agent-tasks/actions';

  let { refusal }: { refusal: WriteRefusal } = $props();
</script>

<div role="alert" class="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300" data-refusal={refusal.kind}>
  {#if refusal.kind === 'refused'}
    <p class="font-semibold">{writeLead()}</p>
    <p class="mt-0.5 flex flex-wrap items-baseline justify-between gap-x-3">
      <span>“{refusal.message}”</span>
      <code class="font-mono text-xs select-all opacity-80">{refusal.code}</code>
    </p>
  {:else if refusal.kind === 'invalid'}
    <p>{refusal.message}</p>
  {:else}
    <p>{WRITE_UNCERTAIN_TEXT()}</p>
  {/if}
</div>
