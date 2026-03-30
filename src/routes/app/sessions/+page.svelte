<script lang="ts">
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  function formatDate(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }

  function duration(start: string, end: string | null): string {
    if (!end) return '—';
    const ms = new Date(end).getTime() - new Date(start).getTime();
    if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
    if (ms < 3600_000) return `${Math.round(ms / 60_000)}m`;
    return `${(ms / 3600_000).toFixed(1)}h`;
  }

  function tokens(inp: number | null, out: number | null): string {
    const total = (inp ?? 0) + (out ?? 0);
    return total > 0 ? total.toLocaleString() : '—';
  }
</script>

<svelte:head><title>Sessions · Hadron</title></svelte:head>

<div class="space-y-6">
  <Breadcrumb items={[
    { label: 'Dashboard', href: '/app/dashboard' },
    { label: 'Sessions' },
  ]} />
  <h1 class="text-2xl font-bold text-zinc-900 dark:text-white">Sessions</h1>

  {#if data.sessions.length === 0}
    <p class="text-sm text-zinc-500">No sessions found.</p>
  {:else}
    <div class="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-zinc-200 bg-zinc-50 text-left text-xs font-medium uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
            <th class="px-4 py-2.5">Started</th>
            <th class="px-4 py-2.5">Type</th>
            <th class="px-4 py-2.5">Summary</th>
            <th class="px-4 py-2.5">Model</th>
            <th class="px-4 py-2.5 text-right">Duration</th>
            <th class="px-4 py-2.5 text-right">Turns</th>
            <th class="px-4 py-2.5 text-right">Tokens</th>
            <th class="px-4 py-2.5 text-right">Errors</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-zinc-200 dark:divide-zinc-800">
          {#each data.sessions as s (s.id)}
            <tr class="bg-white hover:bg-zinc-50 dark:bg-zinc-950 dark:hover:bg-zinc-900">
              <td class="whitespace-nowrap px-4 py-2.5 text-zinc-600 dark:text-zinc-400">{formatDate(s.startedAt)}</td>
              <td class="px-4 py-2.5">
                <span class="rounded px-1.5 py-0.5 text-xs font-medium
                  {s.type === 'DEVELOPER' ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300' :
                   s.type === 'CHATBOT' ? 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300' :
                   s.type === 'AUTOMATION' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/50 dark:text-yellow-300' :
                   'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'}"
                >{s.type}</span>
              </td>
              <td class="max-w-xs truncate px-4 py-2.5 text-zinc-900 dark:text-zinc-200">
                {#if s.summary}
                  {s.summary}
                {:else if s.repo}
                  <span class="font-mono text-zinc-500">{s.repo}{s.branch ? ` (${s.branch})` : ''}</span>
                {:else}
                  <span class="text-zinc-400 italic">—</span>
                {/if}
              </td>
              <td class="whitespace-nowrap px-4 py-2.5 text-zinc-500">{s.llmModel ?? '—'}</td>
              <td class="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-zinc-500">{duration(s.startedAt, s.endedAt)}</td>
              <td class="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-zinc-500">{s.turnCount ?? '—'}</td>
              <td class="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-zinc-500">{tokens(s.inputTokens, s.outputTokens)}</td>
              <td class="whitespace-nowrap px-4 py-2.5 text-right tabular-nums {s.errorCount ? 'text-red-500' : 'text-zinc-400'}">{s.errorCount ?? '—'}</td>
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
          <a href="/app/sessions?page={data.pageNum - 1}" class="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800">Previous</a>
        {/if}
        {#if data.hasMore}
          <a href="/app/sessions?page={data.pageNum + 1}" class="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800">Next</a>
        {/if}
      </div>
    </div>
  {/if}
</div>
