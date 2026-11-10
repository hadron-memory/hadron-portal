<!--
  portal#1052 — one task's history (design §5.3): an ordered list, oldest
  first, read top to bottom like a thread. Not a DataTable: it is a short
  narrative to read in order, not rows to sort, filter or hide columns of.

  Alarms are told apart by `severity`, never by the type's prefix, and carry
  the word "Alarm", so the red rule is a second cue only. v1 is read-only
  (Holger #11535, variant A): an open alarm shows the CLI line that
  acknowledges it, and no button.
-->
<script lang="ts">
  import { t } from '$lib/i18n/t';
  import { fmtRunTime } from '$lib/flow/runs';
  import { alarmRuleName, eventActor, eventSentence, isAlarm, type KnownPeople } from '$lib/agent-tasks/events';
  import { partyName } from '$lib/agent-tasks/status';
  import type { AgentTeamEvent } from '$lib/agent-tasks/types';
  import CopyCode from './CopyCode.svelte';
  import PartyLabel from './PartyLabel.svelte';

  let { events, basePath, people = {} }: { events: AgentTeamEvent[]; basePath: string; people?: KnownPeople } = $props();

  const sortedWakes = (e: AgentTeamEvent) => [...(e.wakes ?? [])].sort((a, b) => a.chainIndex - b.chainIndex);
</script>

{#if events.length === 0}
  <p class="text-sm text-zinc-500 dark:text-zinc-400">{t('app.tasks.history.none', 'No events recorded for this task.')}</p>
{:else}
  <ol class="space-y-2" data-testid="task-history">
    {#each events as e (e.id)}
      {@const actor = eventActor(e)}
      {@const alarm = isAlarm(e)}
      <li class="rounded-md px-3 py-2 {alarm ? 'border-l-4 border-red-500 bg-red-50 dark:bg-red-950/30' : 'bg-zinc-50 dark:bg-zinc-900/50'}" data-alarm={alarm ? 'true' : undefined}>
        <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
          <time datetime={e.createdAt}>{fmtRunTime(e.createdAt)}</time>
          {#if alarm}
            <span class="font-semibold uppercase tracking-wide text-red-700 dark:text-red-300">{t('app.tasks.history.alarm', 'Alarm')}</span>
          {/if}
        </div>
        <div class="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 text-sm text-zinc-800 dark:text-zinc-200">
          {#if alarm}
            <span class="font-medium">{alarmRuleName(e.type)}</span>
          {:else}
            {#if actor.kind === 'party'}
              <PartyLabel party={actor.party} showUrn={false} />
            {:else if actor.kind === 'run'}
              <a href="{basePath}/runs/{actor.runId}" class="font-medium text-indigo-600 hover:underline dark:text-indigo-300">
                {t('app.tasks.history.run', 'Run {id}', { id: actor.runId.slice(0, 8) })}
              </a>
            {:else}
              <span class="font-medium" title={t('app.tasks.history.hadron-title', 'Recorded automatically by the platform')}>Hadron</span>
            {/if}
            {@const sentence = eventSentence(e, people)}
            {#if sentence.known}
              <span>{sentence.text}</span>
              {#each sentence.links ?? [] as l (l.label)}
                <span class="text-xs text-zinc-500 dark:text-zinc-400">{l.label}:
                  {#if l.href}
                    <a href={l.href} target="_blank" rel="noopener noreferrer" class="text-indigo-600 hover:underline dark:text-indigo-300">{l.value}</a>
                  {:else}
                    <code class="font-mono">{l.value}</code>
                  {/if}
                </span>
              {/each}
            {:else}
              <code class="font-mono text-xs">{sentence.type}</code>
              <span class="text-xs text-zinc-500 dark:text-zinc-400">{t('app.tasks.history.unknown', 'This kind of event isn’t described in the portal yet.')}</span>
            {/if}
          {/if}
        </div>
        {#if !alarm}
          {@const detailed = eventSentence(e, people)}
          {#if detailed.known && detailed.detail}
            <!-- An App's own payload: opaque and readable by every participant, so it is text in a disclosure, never markup. -->
            <details class="mt-1 text-xs" data-testid="event-payload">
              <summary class="cursor-pointer text-zinc-600 pointer-coarse:min-h-11 dark:text-zinc-400">{t('app.tasks.history.payload', 'Payload')}</summary>
              <pre class="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-zinc-100 p-2 font-mono text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200">{detailed.detail}</pre>
            </details>
          {/if}
        {/if}
        {#if alarm}
          <ul class="mt-1 space-y-0.5 text-xs text-zinc-600 dark:text-zinc-400">
            {#each sortedWakes(e) as w (w.chainIndex)}
              <li>
                {#if w.wokenAt}
                  {t('app.tasks.alarm.woke', 'Woke {who} at {time}', { who: w.owner ? partyName(w.owner) : t('app.tasks.alarm.nobody', 'nobody'), time: fmtRunTime(w.wokenAt) })}
                {:else if e.acknowledgedAt}
                  {t('app.tasks.alarm.not-woken', '{who}: not woken (acknowledged first)', { who: w.owner ? partyName(w.owner) : '—' })}
                {:else}
                  {t('app.tasks.alarm.would-wake', 'Would wake {who} at {time} if still unacknowledged', { who: w.owner ? partyName(w.owner) : '—', time: fmtRunTime(w.dueAt) })}
                {/if}
              </li>
            {/each}
          </ul>
          <div class="mt-1 text-xs">
            {#if e.acknowledgedAt}
              <span class="text-zinc-700 dark:text-zinc-300">
                {t('app.tasks.alarm.acknowledged', 'Acknowledged by {who}, {time}', {
                  who: e.acknowledgedBy ? partyName(e.acknowledgedBy) : t('app.tasks.alarm.someone', 'someone'),
                  time: fmtRunTime(e.acknowledgedAt),
                })}
              </span>
            {:else}
              <span class="flex flex-wrap items-center gap-2">
                <span class="font-medium text-amber-700 dark:text-amber-300">{t('app.tasks.alarm.open', 'Not acknowledged')}</span>
                <CopyCode value="hadron team alarm ack {e.id}" label={t('app.tasks.alarm.copy-ack', 'Copy the command that acknowledges this alarm')} />
              </span>
            {/if}
          </div>
        {/if}
      </li>
    {/each}
  </ol>
{/if}
