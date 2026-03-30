<script lang="ts">
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  function formatDate(val: string | number | null): string {
    if (!val) return '—';
    const d = new Date(typeof val === 'string' && /^\d+$/.test(val) ? parseInt(val) : val);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function tokens(inp: number | null, out: number | null): string {
    const total = (inp ?? 0) + (out ?? 0);
    return total > 0 ? total.toLocaleString() : '—';
  }

  const typeColors: Record<string, string> = {
    read: 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300',
    write: 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300',
    'action-run': 'bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300',
    'edge-traversal': 'bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300',
    'session-summary': 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
  };

  let nodeLocInput = $state(data.nodeLocFilter ?? '');

  function buildUrl(type: string | null, nodeLoc?: string | null): string {
    const params = new URLSearchParams();
    if (type) params.set('type', type);
    const nl = nodeLoc !== undefined ? nodeLoc : data.nodeLocFilter;
    if (nl) params.set('nodeLoc', nl);
    const qs = params.toString();
    return qs ? `/app/usage?${qs}` : '/app/usage';
  }
</script>

<svelte:head><title>Memory Usage · Hadron</title></svelte:head>

<div class="space-y-6">
  <Breadcrumb items={[
    { label: 'Dashboard', href: '/app/dashboard' },
    { label: 'Memory Usage' },
  ]} />
  <h1 class="text-2xl font-bold text-zinc-900 dark:text-white">Memory Usage</h1>

  <!-- Filters -->
  <div class="flex flex-wrap items-center gap-3">
    <div class="flex gap-2">
      <a href={buildUrl(null)} class="rounded-full px-3 py-1 text-xs font-medium transition {!data.typeFilter ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700'}">All</a>
      {#each ['read', 'write', 'action-run', 'edge-traversal', 'session-summary'] as t}
        <a href={buildUrl(t)} class="rounded-full px-3 py-1 text-xs font-medium transition {data.typeFilter === t ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700'}">{t}</a>
      {/each}
    </div>
    <form class="flex items-center gap-2" action="/app/usage" method="GET">
      {#if data.typeFilter}<input type="hidden" name="type" value={data.typeFilter} />{/if}
      <input
        type="text"
        name="nodeLoc"
        placeholder="Filter by memory or node..."
        bind:value={nodeLocInput}
        class="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500"
      />
      <button type="submit" class="rounded-lg bg-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-300 dark:bg-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-600">Filter</button>
      {#if data.nodeLocFilter}
        <a href={buildUrl(data.typeFilter, null)} class="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">Clear</a>
      {/if}
    </form>
  </div>

  {#if data.events.length === 0}
    <p class="text-sm text-zinc-500">No usage events found.</p>
  {:else}
    <div class="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-zinc-200 bg-zinc-50 text-left text-xs font-medium uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
            <th class="px-4 py-2.5">Time</th>
            <th class="px-4 py-2.5">Type</th>
            <th class="px-4 py-2.5">Node</th>
            <th class="px-4 py-2.5">Model</th>
            <th class="px-4 py-2.5 text-right">Tokens</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-zinc-200 dark:divide-zinc-800">
          {#each data.events as e (e.id)}
            <tr class="bg-white hover:bg-zinc-50 dark:bg-zinc-950 dark:hover:bg-zinc-900">
              <td class="whitespace-nowrap px-4 py-2.5 text-zinc-600 dark:text-zinc-400">{formatDate(e.createdAt)}</td>
              <td class="px-4 py-2.5">
                <span class="rounded px-1.5 py-0.5 text-xs font-medium {typeColors[e.type] ?? 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'}">{e.type}</span>
              </td>
              <td class="max-w-xs truncate px-4 py-2.5 font-mono text-xs text-zinc-700 dark:text-zinc-300">{e.nodeLoc ?? '—'}</td>
              <td class="whitespace-nowrap px-4 py-2.5 text-zinc-500">{e.model ?? '—'}</td>
              <td class="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-zinc-500">{tokens(e.tokensIn, e.tokensOut)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <!-- Pagination -->
    <div class="flex items-center justify-between">
      <div class="text-sm text-zinc-500">Page {data.pageNum}</div>
      <div class="flex gap-2">
        {#if data.pageNum > 1}
          {@const qs = [data.typeFilter ? `type=${data.typeFilter}` : '', data.nodeLocFilter ? `nodeLoc=${encodeURIComponent(data.nodeLocFilter)}` : ''].filter(Boolean).join('&')}
          <a href="/app/usage?page={data.pageNum - 1}{qs ? `&${qs}` : ''}" class="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800">Previous</a>
        {/if}
        {#if data.hasMore}
          {@const qs = [data.typeFilter ? `type=${data.typeFilter}` : '', data.nodeLocFilter ? `nodeLoc=${encodeURIComponent(data.nodeLocFilter)}` : ''].filter(Boolean).join('&')}
          <a href="/app/usage?page={data.pageNum + 1}{qs ? `&${qs}` : ''}" class="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800">Next</a>
        {/if}
      </div>
    </div>
  {/if}
</div>
