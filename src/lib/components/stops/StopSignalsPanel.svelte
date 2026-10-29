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
  import { onDestroy, tick } from 'svelte';
  import { enhance } from '$app/forms';
  import type { SubmitFunction } from '@sveltejs/kit';
  import { invalidateAll } from '$app/navigation';
  import { t } from '$lib/i18n/t';
  import type { WriteRefusal } from '$lib/agent-tasks/actions';
  import WriteRefusalAlert from '$lib/components/agent-tasks/WriteRefusal.svelte';
  import { STOP_LEVELS, levelEffect, levelLabel, scopeCoverage, scopeLabel } from '$lib/stop-signals/present';
  import type { ManagesHint, StopLevel, StopScope, WorkerOption } from '$lib/stop-signals/types';

  let {
    appId,
    manages,
    workers,
    impersonating = null,
    lifting = null,
    onliftclose = () => {},
  }: {
    appId: string;
    manages: ManagesHint;
    workers: WorkerOption[];
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
  let refusal = $state<WriteRefusal | null>(null);
  let status = $state<string | null>(null);
  let statusLine = $state<HTMLElement | null>(null);
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
      generation++;
      level = 'PAUSE_DISPATCH';
      scope = 'WORKER';
      worker = '';
      until = '';
      confirming = false;
      pending = false;
      refusal = null;
      status = null;
      seededFor = appId;
    }
  });
  onDestroy(() => {
    alive = false;
    generation++;
  });

  const controls = $derived(!impersonating && manages !== 'no');
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
      tick().then(() => {
        liftDialog?.showModal();
        liftCancel?.focus();
      });
    }
  });

  function closeLift() {
    if (pending) return;
    liftDialog?.close();
    onliftclose();
  }

  function submitter(kind: 'set' | 'lift'): SubmitFunction {
    return ({ cancel }) => {
      if (pending) {
        cancel();
        return;
      }
      const mine = ++generation;
      pending = true;
      status = null;
      return async ({ result }) => {
        if (!alive || mine !== generation) return;
        pending = false;
        if (result.type === 'success') {
          const changed = kind === 'lift' ? result.data?.changed !== false : true;
          confirming = false;
          dialog?.close();
          liftDialog?.close();
          if (kind === 'lift') onliftclose();
          await invalidateAll();
          if (!alive || mine !== generation) return;
          refusal = null;
          if (kind === 'set') {
            worker = '';
            until = '';
          }
          status =
            kind === 'set'
              ? t('app.stops.saved', 'Stop set. The list below shows the server’s state.')
              : changed
                ? t('app.stops.lifted', 'Stop lifted. Other stops covering the same workers still apply.')
                : t('app.stops.already-ended', 'That stop had already ended; nothing changed.');
          await tick();
          statusLine?.focus();
          return;
        }
        refusal =
          result.type === 'failure' && result.data && typeof result.data === 'object' && 'refusal' in result.data
            ? (result.data.refusal as WriteRefusal)
            : { kind: 'uncertain' };
        confirming = false;
        dialog?.close();
        liftDialog?.close();
        if (kind === 'lift') onliftclose();
        if (refusal.kind === 'uncertain') await invalidateAll();
      };
    };
  }
</script>

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
  {:else}
    {#if manages === 'unknown'}
      <p role="status" class="text-sm text-amber-800 dark:text-amber-300" data-testid="stop-unknown-hint">
        {t('app.stops.unknown-hint', 'Couldn’t check your access. You can try; the server will refuse anyone who doesn’t manage this App.')}
      </p>
    {/if}
    <form
      bind:this={formEl}
      method="POST"
      action="?/set"
      use:enhance={submitter('set')}
      class="space-y-3 rounded-xl border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900"
      onsubmit={(e) => {
        if (!confirming) {
          e.preventDefault();
          openConfirm();
        }
      }}
    >
      <input type="hidden" name="level" value={level} />
      <input type="hidden" name="scope" value={scope} />
      <fieldset class="space-y-1">
        <legend class="font-medium text-zinc-900 dark:text-white">{t('app.stops.level', 'Level')}</legend>
        {#each STOP_LEVELS as l (l)}
          <label class="flex items-start gap-2">
            <input type="radio" name="level-choice" value={l} checked={level === l} onchange={() => (level = l)} class="mt-1" />
            <span><span class="font-medium">{levelLabel(l)}</span> <span class="block text-xs text-zinc-600 dark:text-zinc-400">{levelEffect(l)}</span></span>
          </label>
        {/each}
      </fieldset>
      <fieldset class="space-y-1">
        <legend class="font-medium text-zinc-900 dark:text-white">{t('app.stops.scope', 'Covers')}</legend>
        {#each ['WORKER', 'TEAM'] as s (s)}
          <label class="flex items-center gap-2">
            <input type="radio" name="scope-choice" value={s} checked={scope === s} onchange={() => (scope = s as StopScope)} />
            <span>{scopeLabel(s as StopScope)}</span>
          </label>
        {/each}
        <p class="text-xs text-zinc-600 dark:text-zinc-400">{scopeCoverage(scope)}</p>
      </fieldset>
      <div>
        <label for="stop-worker" class="font-medium text-zinc-900 dark:text-white">
          {scope === 'TEAM' ? t('app.stops.head', 'Team head') : t('app.stops.worker', 'Worker')}
        </label>
        <select
          id="stop-worker"
          name="worker"
          bind:value={worker}
          aria-invalid={refusal?.kind === 'invalid' && refusal.field === 'worker' ? 'true' : undefined}
          class="mt-1 block w-full max-w-sm rounded-md border border-zinc-300 bg-white px-2 py-1 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-white"
        >
          <option value="">{t('app.stops.choose', 'Choose…')}</option>
          {#each workers as w (w.id)}<option value={w.id}>{w.name}</option>{/each}
        </select>
      </div>
      <div>
        <label for="stop-until" class="font-medium text-zinc-900 dark:text-white">{t('app.stops.until-label', 'Until (optional)')}</label>
        <input
          id="stop-until"
          name="until"
          type="datetime-local"
          bind:value={until}
          aria-describedby="stop-until-help"
          class="mt-1 block rounded-md border border-zinc-300 bg-white px-2 py-1 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-white"
        />
        <p id="stop-until-help" class="mt-1 text-xs text-zinc-600 dark:text-zinc-400">{t('app.stops.until-help', 'Leave empty to stop until someone lifts it.')}</p>
      </div>
      {#if refusal}<WriteRefusalAlert {refusal} />{/if}
      {#if status}
        <p bind:this={statusLine} tabindex="-1" role="status" aria-live="polite" class="text-sm font-medium text-green-700 dark:text-green-300">{status}</p>
      {/if}
      <button type="submit" data-open-confirm disabled={pending} class="rounded-md bg-red-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-600 disabled:opacity-50">
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
            <p>{scopeCoverage(scope)}</p>
            <p>{levelEffect(level)}</p>
            <p>{until ? t('app.stops.confirm.until', 'It ends on its own at {time}.', { time: until }) : t('app.stops.confirm.open', 'It lasts until someone lifts it.')}</p>
            <p>{t('app.stops.confirm.messages', 'Messages are not held by any level.')}</p>
          </div>
          <div class="mt-4 flex flex-wrap justify-end gap-3">
            <button bind:this={cancelButton} type="button" onclick={closeConfirm} disabled={pending} class="rounded-md border border-zinc-300 px-3 py-2 text-sm disabled:opacity-50 dark:border-zinc-600">
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
        <button bind:this={liftCancel} type="button" onclick={closeLift} disabled={pending} class="rounded-md border border-zinc-300 px-3 py-2 text-sm disabled:opacity-50 dark:border-zinc-600">
          {t('app.stops.lift.cancel', 'Cancel')}
        </button>
        <button type="submit" disabled={pending} class="rounded-md bg-indigo-600 px-3 py-2 text-sm text-white disabled:opacity-50">
          {pending ? t('app.stops.lift.pending', 'Lifting…') : t('app.stops.lift.submit', 'Lift stop')}
        </button>
      </form>
    </dialog>
  {/if}
</section>
