<!--
  portal#1139 — set and lift stop signals.

  - Controls follow `App.viewerManages` as a DISPLAY hint only: yes shows them,
    no is read-only, unknown (a failed hint read) says so and shows them too so
    the server's refusal can answer. The server decides on every call.
  - Every set and every lift goes through a confirmation naming only the
    persisted enforcement of that level; Cancel holds the focus. Single-flight.
  - Nothing is optimistic: a success reloads and shows the server's state. A
    typed refusal (including "nothing was set") shows its fixed sentence; an
    unknown code or transport failure shows the uncertain line and re-reads.
  - `generation` fences a result that lands after the App changed or the panel
    unmounted.
-->
<script lang="ts">
  import LiveOutcome from '$lib/components/LiveOutcome.svelte';
  import LiveRegion from '$lib/components/LiveRegion.svelte';
  import { onDestroy, tick } from 'svelte';
  import { enhance } from '$app/forms';
  import type { SubmitFunction } from '@sveltejs/kit';
  import { goto, invalidateAll } from '$app/navigation';
  import { t } from '$lib/i18n/t';
  import { WRITE_UNCERTAIN_TEXT, writeLead, type WriteRefusal } from '$lib/agent-tasks/actions';
  import Urn from '$lib/components/Urn.svelte';
  import WriteRefusalAlert from '$lib/components/agent-tasks/WriteRefusal.svelte';
  import { STOP_LEVELS, fmtStopTime, levelEffect, levelLabel, scopeCoverage, scopeLabel } from '$lib/stop-signals/present';
  import type { ManagesHint, StopLevel, StopScope, WorkerOption } from '$lib/stop-signals/types';

  let {
    appId,
    manages,
    workers,
    rosterFailed = false,
    impersonating = null,
    lifting = null,
    onliftclose = () => {},
  }: {
    appId: string;
    manages: ManagesHint;
    workers: WorkerOption[];
    /** The roster read failed: `workers` is empty because it is unknown, not because the team has no one. */
    rosterFailed?: boolean;
    impersonating?: string | null;
    /** A live signal the reader chose to lift; set by the table's Lift button. */
    lifting?: { id: string; label: string } | null;
    onliftclose?: () => void;
  } = $props();

  let level = $state<StopLevel>('PAUSE_DISPATCH');
  let scope = $state<StopScope>('WORKER');
  let worker = $state('');
  let until = $state('');
  let confirming = $state(false);
  let pending = $state(false);
  // Which request is in flight. Only a lift's own request holds the lift dialog open.
  let pendingKind = $state<'set' | 'lift' | null>(null);
  let refusal = $state<WriteRefusal | null>(null);
  let status = $state<string | null>(null);
  let statusLine = $state<HTMLElement | null>(null);
  // One status line for every lift, outside the set form: the table is where the action happened.
  let liftNote = $state<{ text: string; failed?: boolean } | null>(null);
  let liftLine = $state<HTMLElement | null>(null);
  let cancelButton = $state<HTMLButtonElement | null>(null);
  let formEl = $state<HTMLFormElement | null>(null);
  let dialog = $state<HTMLDialogElement | null>(null);
  let liftDialog = $state<HTMLDialogElement | null>(null);
  let liftCancel = $state<HTMLButtonElement | null>(null);

  // Plain, not $state: only ever compared.
  let generation = 0;
  let alive = true;
  let seededFor = $state<string | null>(null);
  $effect.pre(() => {
    if (seededFor !== appId) {
      // The page keeps `lifting` across an App change; a confirmation for
      // App A's stop must not survive into App B.
      if (seededFor !== null && lifting) {
        liftDialog?.close();
        onliftclose();
      }
      generation++;
      level = 'PAUSE_DISPATCH';
      scope = 'WORKER';
      worker = '';
      until = '';
      confirming = false;
      pending = false;
      pendingKind = null;
      refusal = null;
      status = null;
      liftNote = null;
      seededFor = appId;
    }
  });
  onDestroy(() => {
    alive = false;
    generation++;
  });

  const controls = $derived(!impersonating && manages === 'yes');
  const workerUrn = $derived(workers.find((w) => w.id === worker)?.urn ?? null);
  // datetime-local is zone-less: convert in the browser so the server gets the
  // reader's instant (ISO, with zone) and the dialog shows what will be set.
  const untilIso = $derived.by(() => {
    if (!until) return '';
    const ms = new Date(until).getTime();
    return Number.isNaN(ms) ? '' : new Date(ms).toISOString();
  });
  const minUntil = $derived.by(() => {
    const d = new Date();
    d.setSeconds(0, 0);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  });
  const invalidField = $derived(refusal?.kind === 'invalid' ? refusal.field : null);
  const invalidFor = (f: string) => (invalidField === f ? 'true' : undefined);
  const describedBy = (f: string) => (invalidField === f ? 'stop-refusal' : undefined);
  const workerName = $derived(workers.find((w) => w.id === worker)?.name ?? worker);

  async function openConfirm() {
    refusal = null;
    status = null;
    if (!worker) {
      refusal = {
        kind: 'invalid',
        field: 'worker',
        message: scope === 'TEAM' ? t('app.stops.invalid.head', 'Choose the worker who heads the team.') : t('app.stops.invalid.worker', 'Choose a worker.'),
      };
      return;
    }
    confirming = true;
    await tick();
    dialog?.showModal();
    cancelButton?.focus();
  }

  function closeConfirm() {
    if (pending) return;
    confirming = false;
    dialog?.close();
    formEl?.querySelector<HTMLElement>('button[data-open-confirm]')?.focus();
  }

  $effect(() => {
    if (lifting) {
      refusal = null;
      status = null;
      liftNote = null;
      tick().then(() => {
        liftDialog?.showModal();
        liftCancel?.focus();
      });
    }
  });

  function closeLift() {
    if (pendingKind === 'lift') return;
    liftDialog?.close();
    onliftclose();
  }

  /** A lift refusal as one status sentence, in the same words the alert uses. */
  function refusalText(r: WriteRefusal): string {
    if (r.kind === 'refused') return `${writeLead()}: “${r.message}” (${r.code})`;
    if (r.kind === 'invalid') return r.message;
    return WRITE_UNCERTAIN_TEXT();
  }

  function submitter(kind: 'set' | 'lift'): SubmitFunction {
    return ({ cancel }) => {
      // Review is not a submit: only the confirmation's own button sends. Kit
      // prevents the native submit itself and sends unless we cancel, so an
      // Enter key or a stray submit before the dialog opened must stop here.
      if (pending || (kind === 'set' && !confirming)) {
        cancel();
        if (kind === 'set' && !pending && !confirming) void openConfirm();
        return;
      }
      const mine = ++generation;
      pending = true;
      pendingKind = kind;
      status = null;
      liftNote = null;
      return async ({ result }) => {
        if (!alive || mine !== generation) return;
        pending = false;
        pendingKind = null;
        if (result.type === 'success') {
          const changed = kind === 'lift' ? result.data?.changed !== false : true;
          if (kind === 'set') {
            confirming = false;
            dialog?.close();
          } else {
            liftDialog?.close();
            onliftclose();
          }
          await invalidateAll();
          if (!alive || mine !== generation) return;
          if (kind === 'set') {
            refusal = null;
            worker = '';
            until = '';
            status = t('app.stops.saved', 'Stop set. The list below shows the server’s state.');
            await tick();
            statusLine?.focus();
          } else {
            liftNote = {
              text: changed
                ? t('app.stops.lifted', 'Stop lifted. Other stops covering the same workers still apply.')
                : t('app.stops.already-ended', 'That stop had already ended; nothing changed.'),
            };
            await tick();
            liftLine?.focus();
          }
          return;
        }
        // A redirect (an expired session sent to sign-in) is an answer, not an
        // unknown: follow it instead of reading it as "may not have gone through".
        if (result.type === 'redirect') {
          await goto(result.location);
          return;
        }
        const failed: WriteRefusal =
          result.type === 'failure' && result.data && typeof result.data === 'object' && 'refusal' in result.data
            ? (result.data.refusal as WriteRefusal)
            : { kind: 'uncertain' };
        if (kind === 'set') {
          refusal = failed;
          confirming = false;
          dialog?.close();
        } else {
          liftNote = { text: refusalText(failed), failed: true };
          liftDialog?.close();
          onliftclose();
        }
        if (failed.kind === 'uncertain') await invalidateAll();
        if (kind === 'lift') {
          await tick();
          if (alive && mine === generation) liftLine?.focus();
        }
      };
    };
  }
</script>

<!-- portal#2379: one plain wrapper, so the page sees a single child and the outcome after the space-y section adds no idle gap (Marco's placement rule, hadron-portal#2386). -->
<div>
<section aria-labelledby="stop-set-heading" class="space-y-3" data-testid="stop-panel">
  <h2 id="stop-set-heading" class="text-sm font-semibold text-zinc-900 dark:text-white">{t('app.stops.set.heading', 'Stop a worker or team')}</h2>

  {#if impersonating}
    <p class="text-xs text-zinc-500 dark:text-zinc-400">
      {t('app.tasks.write.impersonating', 'Viewing as {name}: changes are switched off in a support session.', { name: impersonating })}
    </p>
  {:else if manages === 'no'}
    <p class="text-sm text-zinc-600 dark:text-zinc-400" data-testid="stop-read-only">
      {t('app.stops.read-only', 'Only whoever manages this App can set or lift a stop. You can see the stops below.')}
    </p>
  {:else if manages === 'unknown'}
    <p role="status" class="text-sm text-amber-800 dark:text-amber-300" data-testid="stop-unknown-hint">
      {t('app.stops.unknown-hint', 'Couldn’t check whether you manage this App, so stops can’t be set or lifted from here right now. Reload to try again. You can see the stops below.')}
    </p>
  {:else}
    <form
      bind:this={formEl}
      method="POST"
      action="?/set"
      use:enhance={submitter('set')}
      class="space-y-3 rounded-xl border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900"
    >
      <input type="hidden" name="level" value={level} />
      <input type="hidden" name="scope" value={scope} />
      <fieldset class="space-y-1" role="radiogroup" data-field="level" aria-invalid={invalidFor('level')} aria-describedby={describedBy('level')}>
        <legend class="font-medium text-zinc-900 dark:text-white">{t('app.stops.level', 'Level')}</legend>
        {#each STOP_LEVELS as l (l)}
          <label class="flex min-h-11 items-start gap-2 py-1">
            <input type="radio" name="level-choice" value={l} checked={level === l} onchange={() => (level = l)} class="mt-1" />
            <span><span class="font-medium">{levelLabel(l)}</span> <span class="block text-xs text-zinc-600 dark:text-zinc-400">{levelEffect(l)}</span></span>
          </label>
        {/each}
      </fieldset>
      <fieldset class="space-y-1" role="radiogroup" data-field="scope" aria-invalid={invalidFor('scope')} aria-describedby={describedBy('scope')}>
        <legend class="font-medium text-zinc-900 dark:text-white">{t('app.stops.scope', 'Covers')}</legend>
        {#each ['WORKER', 'TEAM'] as s (s)}
          <label class="flex min-h-11 items-center gap-2">
            <input type="radio" name="scope-choice" value={s} checked={scope === s} onchange={() => (scope = s as StopScope)} />
            <span>{scopeLabel(s as StopScope)}</span>
          </label>
        {/each}
        <p class="text-xs text-zinc-600 dark:text-zinc-400">{scopeCoverage(scope)}</p>
      </fieldset>
      <div>
        <label for="stop-worker" class="font-medium text-zinc-900 dark:text-white">
          {scope === 'TEAM' ? t('app.stops.team-head', 'Team head') : t('app.stops.worker', 'Worker')}
        </label>
        <select
          id="stop-worker"
          name="worker"
          bind:value={worker}
          aria-invalid={invalidFor('worker')}
          aria-describedby={[describedBy('worker'), rosterFailed ? 'stop-worker-hint' : undefined].filter(Boolean).join(' ') || undefined}
          class="mt-1 block w-full max-w-sm rounded-md border border-zinc-300 bg-white px-2 py-1 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-white"
        >
          <option value="">{t('app.stops.choose', 'Choose…')}</option>
          {#each workers as w (w.id)}<option value={w.id}>{w.name}</option>{/each}
        </select>
        {#if rosterFailed}
          <p id="stop-worker-hint" class="mt-1 text-xs text-amber-800 dark:text-amber-300">{t('app.stops.roster-failed', 'Couldn’t load the team roster. Reload the page to try again.')}</p>
        {/if}
      </div>
      <div>
        <label for="stop-until" class="font-medium text-zinc-900 dark:text-white">{t('app.stops.until-label', 'Until (optional)')}</label>
        <input
          id="stop-until"
          type="datetime-local"
          min={minUntil}
          bind:value={until}
          aria-invalid={invalidFor('until')}
          aria-describedby={['stop-until-help', describedBy('until')].filter(Boolean).join(' ')}
          class="mt-1 block rounded-md border border-zinc-300 bg-white px-2 py-1 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-white"
        />
        <input type="hidden" name="until" value={untilIso} />
        <p id="stop-until-help" class="mt-1 text-xs text-zinc-600 dark:text-zinc-400">{t('app.stops.until-help', 'Leave empty to stop until someone lifts it.')}</p>
      </div>
      {#if refusal}<WriteRefusalAlert {refusal} id="stop-refusal" />{/if}
      <LiveRegion>
        {#if status}
          <p bind:this={statusLine} tabindex="-1" class="text-sm font-medium text-green-700 dark:text-green-300">{status}</p>
        {/if}
      </LiveRegion>
      <button type="button" data-open-confirm onclick={openConfirm} disabled={pending} class="rounded-md bg-red-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-600 disabled:opacity-50">
        {t('app.stops.review', 'Review stop…')}
      </button>

      {#if confirming}
        <dialog
          bind:this={dialog}
          aria-labelledby="stop-confirm-title"
          aria-describedby="stop-confirm-body"
          oncancel={(e) => {
            e.preventDefault();
            closeConfirm();
          }}
          class="m-auto w-[calc(100%-2rem)] max-w-lg rounded-xl border border-zinc-200 bg-white p-5 text-zinc-900 shadow-xl backdrop:bg-black/60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
        >
          <h3 id="stop-confirm-title" class="text-lg font-semibold">{t('app.stops.confirm.title', 'Set this stop?')}</h3>
          <div id="stop-confirm-body" class="mt-3 space-y-2 text-sm">
            <p><span class="font-medium">{levelLabel(level)}</span> · {scopeLabel(scope)} · {workerName}</p>
            {#if workerUrn}<p><Urn value={workerUrn} /></p>{/if}
            <p>{scopeCoverage(scope)}</p>
            <p>{levelEffect(level)}</p>
            <p>{untilIso ? t('app.stops.confirm.until', 'It ends on its own at {time}.', { time: fmtStopTime(untilIso) }) : t('app.stops.confirm.open', 'It lasts until someone lifts it.')}</p>
            <p>{t('app.stops.confirm.messages', 'Messages are not held by any level.')}</p>
          </div>
          <div class="mt-4 flex flex-wrap justify-end gap-3">
            <button bind:this={cancelButton} data-testid="stop-confirm-cancel" type="button" onclick={closeConfirm} disabled={pending} class="rounded-md border border-zinc-300 px-3 py-2 text-sm disabled:opacity-50 dark:border-zinc-600">
              {t('app.stops.confirm.cancel', 'Cancel')}
            </button>
            <button type="submit" disabled={pending} class="rounded-md bg-red-700 px-3 py-2 text-sm text-white disabled:opacity-50">
              {pending ? t('app.stops.confirm.pending', 'Setting…') : t('app.stops.confirm.submit', 'Set stop')}
            </button>
          </div>
        </dialog>
      {/if}
    </form>
  {/if}


  {#if lifting && controls}
    <dialog
      bind:this={liftDialog}
      aria-labelledby="stop-lift-title"
      aria-describedby="stop-lift-body"
      oncancel={(e) => {
        e.preventDefault();
        closeLift();
      }}
      class="m-auto w-[calc(100%-2rem)] max-w-lg rounded-xl border border-zinc-200 bg-white p-5 text-zinc-900 shadow-xl backdrop:bg-black/60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
    >
      <h3 id="stop-lift-title" class="text-lg font-semibold">{t('app.stops.lift.title', 'Lift this stop?')}</h3>
      <p id="stop-lift-body" class="mt-3 text-sm">
        {lifting.label}
        <span class="mt-2 block">{t('app.stops.lift.body', 'This lifts only this stop. Other stops covering the same workers still apply.')}</span>
      </p>
      <form method="POST" action="?/lift" use:enhance={submitter('lift')} class="mt-4 flex flex-wrap justify-end gap-3">
        <input type="hidden" name="id" value={lifting.id} />
        <button bind:this={liftCancel} data-testid="stop-confirm-cancel" type="button" onclick={closeLift} disabled={pendingKind === 'lift'} class="rounded-md border border-zinc-300 px-3 py-2 text-sm disabled:opacity-50 dark:border-zinc-600">
          {t('app.stops.lift.cancel', 'Cancel')}
        </button>
        <button type="submit" disabled={pending} class="rounded-md bg-indigo-600 px-3 py-2 text-sm text-white disabled:opacity-50">
          {pending ? t('app.stops.lift.pending', 'Lifting…') : t('app.stops.lift.submit', 'Lift stop')}
        </button>
      </form>
    </dialog>
  {/if}
</section>
<!-- portal#2379: after the space-y section, not inside it, with the old top margin on the box. -->
<LiveOutcome failed={liftNote?.failed ?? false}>
  {#if liftNote}
    <p
      bind:this={liftLine}
      tabindex="-1"
      data-testid="stop-lift-status"
      class="mt-3 rounded-lg border px-3 py-2 text-sm {liftNote.failed
        ? 'border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200'
        : 'border-zinc-300 bg-zinc-50 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white'}"
    >{liftNote.text}</p>
  {/if}
</LiveOutcome>
</div>
