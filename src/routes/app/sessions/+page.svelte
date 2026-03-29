<script lang="ts">
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  function formatDate(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
      + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }

  function duration(start: string, end: string | null): string {
    if (!end) return 'active';
    const ms = new Date(end).getTime() - new Date(start).getTime();
    if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
    if (ms < 3600_000) return `${Math.round(ms / 60_000)}m`;
    return `${(ms / 3600_000).toFixed(1)}h`;
  }

  const typeColors: Record<string, string> = {
    DEVELOPER: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300',
    CHATBOT: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
    AUTOMATION: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300',
    EDGE: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  };
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
    <div class="divide-y divide-zinc-200 rounded-xl border border-zinc-200 overflow-hidden dark:divide-zinc-800 dark:border-zinc-800">
      {#each data.sessions as s (s.id)}
        <div class="flex items-start gap-4 bg-white px-5 py-4 dark:bg-zinc-900">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 mb-1">
              <span class="rounded-full px-2 py-0.5 text-xs font-medium {typeColors[s.type] ?? typeColors.EDGE}">{s.type}</span>
              <span class="text-xs text-zinc-500">{formatDate(s.startedAt)}</span>
              <span class="text-xs text-zinc-400">{duration(s.startedAt, s.endedAt)}</span>
            </div>
            {#if s.summary}
              <p class="text-sm text-zinc-900 dark:text-white truncate">{s.summary}</p>
            {:else if s.repo}
              <p class="text-sm font-mono text-zinc-600 dark:text-zinc-400">{s.repo}{s.branch ? ` (${s.branch})` : ''}</p>
            {:else}
              <p class="text-sm text-zinc-400 italic">No summary</p>
            {/if}
            <div class="mt-1 flex gap-3 text-xs text-zinc-500">
              {#if s.llmModel}<span>{s.llmModel}</span>{/if}
              {#if s.turnCount}<span>{s.turnCount} turns</span>{/if}
              {#if s.inputTokens || s.outputTokens}
                <span>{((s.inputTokens ?? 0) + (s.outputTokens ?? 0)).toLocaleString()} tokens</span>
              {/if}
              {#if s.errorCount}<span class="text-red-400">{s.errorCount} errors</span>{/if}
            </div>
          </div>
        </div>
      {/each}
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
