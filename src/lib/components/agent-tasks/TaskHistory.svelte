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
  import { START_FAILING_ALARM_TYPE, alarmRuleName, eventActor, eventSentence, isAlarm, type KnownPeople } from '$lib/agent-tasks/events';
  import { taskHref } from '$lib/agent-tasks/handle';
  import { partyName } from '$lib/agent-tasks/status';
  import type { AgentTeamEvent } from '$lib/agent-tasks/types';
  import Urn from '$lib/components/Urn.svelte';
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
      {@const sentence = alarm ? null : eventSentence(e, people)}
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
            {#if e.type === START_FAILING_ALARM_TYPE && e.subjectWorker}<PartyLabel party={e.subjectWorker} />{/if}
          {:else}
            {#if actor.kind === 'party'}
              <PartyLabel party={actor.party} showUrn={false} />
            {:else if actor.kind === 'run'}
              <!-- portal#1711: a coarse touch target must RESERVE its space. Vertical padding on a
                non-replaced inline anchor paints and hit-tests outside the line box without moving
                layout, so the padded area overlaps neighbouring rows and steals their taps. An atomic
                inline-flex box with min-h-11 grows the line box itself (the <summary> below does the
                same), so the space is reserved and nothing is overlapped. -->
              <a href="{basePath}/runs/{actor.runId}" class="font-medium text-indigo-600 hover:underline pointer-coarse:inline-flex pointer-coarse:items-center pointer-coarse:min-h-11 dark:text-indigo-300">
                {t('app.tasks.history.run', 'Run {id}', { id: actor.runId.slice(0, 8) })}
              </a>
            {:else}
              <span class="font-medium" title={t('app.tasks.history.hadron-title', 'Recorded automatically by the platform')}>Hadron</span>
            {/if}
            {#if sentence && sentence.known}
              <span>{sentence.text}</span>
              {#each sentence.links ?? [] as l (l.label)}
                <!-- portal#1711: a value is a web url (new tab), a node URN (shared chip), a sibling seat task (in-app), or text — and a long one wraps instead of overflowing. -->
                <span class="min-w-0 text-xs text-zinc-500 dark:text-zinc-400">{l.label}:
                  {#if l.kind === 'url'}
                    <!-- Atomic like the run link: the label span's min-w-0 lets this box shrink to
                      the row, and break-all wraps a long receipt url INSIDE it, so the reserved
                      min-h-11 box covers every wrapped line (measured by the layout probe). -->
                    <a href={l.value} target="_blank" rel="noopener noreferrer" class="break-all text-indigo-600 hover:underline pointer-coarse:inline-flex pointer-coarse:items-center pointer-coarse:min-h-11 dark:text-indigo-300">{l.value}</a>
                  {:else if l.kind === 'nodeUrn'}
                    <Urn linked value={l.value} label={l.label} />
                  {:else if l.kind === 'task'}
                    <a href={taskHref(basePath, { id: l.id })} title={l.id} class="font-mono text-indigo-600 hover:underline pointer-coarse:inline-flex pointer-coarse:items-center pointer-coarse:min-h-11 dark:text-indigo-300">{l.value}</a>
                  {:else}
                    <code class="break-all font-mono">{l.value}</code>
                  {/if}
                </span>
              {/each}
            {:else if sentence}
              <code class="font-mono text-xs">{sentence.type}</code>
              <span class="text-xs text-zinc-500 dark:text-zinc-400">{t('app.tasks.history.unknown', 'This kind of event isn’t described in the portal yet.')}</span>
            {/if}
          {/if}
        </div>
        {#if !alarm}
          {#if sentence && sentence.known && sentence.detail}
            <!-- An App's own payload: opaque and readable by every participant, so it is text in a disclosure, never markup. -->
            <details class="mt-1 text-xs" data-testid="event-payload">
              <summary class="cursor-pointer text-zinc-600 pointer-coarse:min-h-11 dark:text-zinc-400">{t('app.tasks.history.payload', 'Payload')}</summary>
              <pre class="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-zinc-100 p-2 font-mono text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200">{sentence.detail}</pre>
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
