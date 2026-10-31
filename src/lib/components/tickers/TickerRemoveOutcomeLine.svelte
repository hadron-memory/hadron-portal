<!--
  portal#1502 (delta seats): the page-level line a finished removal leaves
  behind. The reload that carries a committed removal (or the stale-row
  SUBSCRIPTION_NOT_FOUND refusal) drops the row, the row is what keeps the
  Remove panel mounted — so the result must outlive the panel, and the PAGE
  owns it. This component is that one always-present live region: empty from
  first paint, so whatever lands in it is announced as a change, never
  swapped in (hrn:node:hadronmemory.com:hadron-portal:review:outcome-outlives-its-own-reload).

  The caveats render INSIDE the region (an element inserted already-populated
  beside it would not be announced — portal#1502 BLIND delta, Gaby P3), each
  on its OWN line (block): inline after the chip they ran into it and into
  each other — "stands.Saved;" (portal#1502 UX delta, Uma P2). The worker's
  Urn chip rides the sentence because, once the row is gone, this line is the
  only thing that names whom, and a name alone is not addressable
  (hrn:node:hadronmemory.com:hadron-portal:review:render-urn).

  Its own component (not page markup) so the layout harness can mount the
  populated region directly — the flow that reaches it needs a delivered
  action result, which a page mounted outside kit can never receive
  (hrn:node:hadronmemory.com:hadron-portal:findings:enhance-deserialize-needs-a-booted-app).
-->
<script lang="ts">
  import Urn from '$lib/components/Urn.svelte';
  import { announcementFailedText, tickerRefreshFailedLine } from '$lib/tickers/controls';

  let {
    text = '',
    workerUrn = null,
    announcementFailed = false,
    refreshFailed = false,
  }: {
    /** Empty (not absent) until an outcome lands — the region itself never unmounts. */
    text?: string;
    /** The removed worker's URN; null (the stale-row refusal, or nothing yet) renders no chip. */
    workerUrn?: string | null;
    announcementFailed?: boolean;
    refreshFailed?: boolean;
  } = $props();
</script>

<p role="status" class="text-sm text-zinc-900 dark:text-white" data-testid="ticker-remove-outcome">{text}{#if workerUrn} <Urn value={workerUrn} size={9} compact linked />{/if}{#if announcementFailed} <span class="block text-xs text-amber-800 dark:text-amber-300" data-testid="ticker-remove-outcome-announcement">{announcementFailedText()}</span>{/if}{#if refreshFailed} <span class="block text-xs text-amber-800 dark:text-amber-300" data-testid="ticker-remove-outcome-refresh-failed">{tickerRefreshFailedLine()}</span>{/if}</p>
