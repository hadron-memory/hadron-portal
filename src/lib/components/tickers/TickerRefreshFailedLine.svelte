<!--
  portal#1497 (MCP cut R7a) — the one line a committed ticker action says when
  the page refresh that followed it failed: the write stands, the page could
  not reload, and nothing is sent again from here. Rendered by each control
  while it is still mounted (its own refresh rejected), and by the route's
  error boundary (the ticker refresh marker's note) when kit unmounted it.
-->
<script lang="ts">
  import { tickerRefreshFailedLine } from '$lib/tickers/controls';

  let { testid = 'ticker-refresh-failed' }: { testid?: string } = $props();
</script>

<p role="status" class="text-xs text-amber-800 dark:text-amber-300" data-testid={testid}>{tickerRefreshFailedLine()}</p>
