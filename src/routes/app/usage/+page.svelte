<script lang="ts">
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  function formatDate(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
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

  function buildUrl(type: string | null): string {
    const params = new URLSearchParams();
    if (type) params.set('type', type);
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

  <!-- Type filter -->
  <div class="flex gap-2">
    <a href={buildUrl(null)} class="rounded-full px-3 py-1 text-xs font-medium transition {!data.typeFilter ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700'}">All</a>
    {#each ['read', 'write', 'action-run', 'edge-traversal', 'session-summary'] as t}
      <a href={buildUrl(t)} class="rounded-full px-3 py-1 text-xs font-medium transition {data.typeFilter === t ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700'}">{t}</a>
    {/each}
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
          <a href="/app/usage?page={data.pageNum - 1}{data.typeFilter ? `&type=${data.typeFilter}` : ''}" class="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800">Previous</a>
        {/if}
        {#if data.hasMore}
          <a href="/app/usage?page={data.pageNum + 1}{data.typeFilter ? `&type=${data.typeFilter}` : ''}" class="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800">Next</a>
        {/if}
      </div>
    </div>
  {/if}
</div>
