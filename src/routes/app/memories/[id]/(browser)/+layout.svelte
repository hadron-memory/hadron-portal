<script lang="ts">
  // portal#1433 (D2): the Nodes/Graph browser. Both tabs live in this route
  // group so they share ONE MemoryBrowser mounted here, in the group's layout:
  // its tree width, open/closed, search and filters survive switching between
  // the two tabs (a page component per tab would remount it). The pages only set
  // the <title>. The whole node graph is drained by this group's
  // `+layout.server.ts`, so no route outside the group pays for it.
  import { getContext } from 'svelte';
  import { page } from '$app/stores';
  import MemoryBrowser from '$lib/components/MemoryBrowser.svelte';
  import { MEMORY_APPROVALS_VERSION } from '$lib/memory/approvals-version';
  import { t } from '$lib/i18n/t';
  import type { LayoutData } from './$types';

  let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();

  const basePath = $derived(`/app/memories/${data.graph.id}`);
  const readOnly = $derived(data.canWriteMemory !== true);
  const approvalsVersion = getContext<(() => number) | undefined>(MEMORY_APPROVALS_VERSION);

  // The view follows the route suffix: `/nodes` or `/graph`. Matched on the
  // suffix, not on a rebuilt path, because `[id]` may be a URN ref (@codex on #771).
  const forcedView = $derived<'nodes' | 'graph'>(
    $page.url.pathname.replace(/\/+$/, '').split('/').pop() === 'graph' ? 'graph' : 'nodes',
  );
</script>

{#if data.nodesFailed}
  <div class="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
    {t('memory-detail.nodes-load-error', "Couldn't load this memory's nodes — the node service returned an error. This is not the same as an empty memory; try refreshing, and if it persists check the hadron-server logs.")}
  </div>
{/if}
<!-- #589: memory drives the structured-query UI (schema pickers +
     encrypted-data annotation). -->
<MemoryBrowser {readOnly} nodes={data.graphNodes ?? []} nodesTotal={data.nodesTotal} {basePath} {forcedView} memory={data.graph} refreshKey={approvalsVersion?.() ?? 0} />
{@render children()}
