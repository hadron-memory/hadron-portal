<script lang="ts">
  import { t } from '$lib/i18n/t';

  interface RouteTraceData {
    conversationLoc: string | null;
    stageLoc: string | null;
    personaName: string | null;
    routeCandidates?: Array<{ conversationLoc: string; rejected: boolean; reason?: string }>;
    onTrack?: boolean;
    offTrackReason?: string | null;
  }

  let { trace }: { trace: RouteTraceData } = $props();
</script>

<div class="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900">
  <h4 class="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
    {t('agent-tester.trace.heading', 'Route trace')}
  </h4>
  <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
    <dt class="text-zinc-500 dark:text-zinc-400">{t('agent-tester.trace.conversation', 'Conversation')}</dt>
    <dd class="font-mono text-zinc-900 dark:text-zinc-100">{trace.conversationLoc ?? '—'}</dd>
    <dt class="text-zinc-500 dark:text-zinc-400">{t('agent-tester.trace.stage', 'Stage')}</dt>
    <dd class="font-mono text-zinc-900 dark:text-zinc-100">{trace.stageLoc ?? '—'}</dd>
    <dt class="text-zinc-500 dark:text-zinc-400">{t('agent-tester.trace.persona', 'Persona')}</dt>
    <dd class="text-zinc-900 dark:text-zinc-100">{trace.personaName ?? t('agent-tester.trace.no-persona', '(default routing)')}</dd>
    {#if trace.onTrack === false}
      <dt class="text-amber-600 dark:text-amber-400">{t('agent-tester.trace.off-track', 'Off-track')}</dt>
      <dd class="text-amber-700 dark:text-amber-300">{trace.offTrackReason ?? t('agent-tester.trace.off-track-no-reason', '(no reason reported)')}</dd>
    {/if}
  </dl>
  {#if trace.routeCandidates?.length}
    <details class="mt-2 text-xs">
      <summary class="cursor-pointer text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-300">
        {t('agent-tester.trace.candidates', 'Route candidates')} ({trace.routeCandidates.length})
      </summary>
      <ul class="mt-1 space-y-0.5 pl-3">
        {#each trace.routeCandidates as c (c.conversationLoc)}
          <li class="font-mono {c.rejected ? 'text-zinc-400 line-through' : 'text-zinc-900 dark:text-zinc-100'}">
            {c.conversationLoc}{c.reason ? ` — ${c.reason}` : ''}
          </li>
        {/each}
      </ul>
    </details>
  {/if}
</div>
