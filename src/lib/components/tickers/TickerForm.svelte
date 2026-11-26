<!--
  portal#1151 (Tickers S7b) — the one form that creates a ticker (App Tickers
  page) and edits one (the ticker page). The user wants to name a ticker, say
  how often it ticks and what wakes a subscriber, and save it.

  - Every participant whose read succeeded is offered the form. Who may create
    or edit is the server's call (hrn:node:hadronmemory.com:specs:cor:agt:080:18); its refusal renders beside
    the form, and a support (impersonation) session sees no form at all.
  - Create always sends an explicit reasons set ("Team chat" is only the
    preselection). An edit sends only what changed (see buildUpdatePatch), so
    reasons the reader left alone are omitted, never re-sent.
  - No activation control, and no client-side check of cadence, cap or
    consent: the server's refusals are the answer, shown as they come.
  - Nothing is optimistic. A refusal keeps what was typed; a success reloads
    and shows the STORED values. An uncertain outcome is shown as uncertain
    and is not retried.
-->
<script lang="ts">
  import LiveRegion from '$lib/components/LiveRegion.svelte';
  import { onDestroy, tick } from 'svelte';
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import { t } from '$lib/i18n/t';
  import type { WriteRefusal } from '$lib/agent-tasks/actions';
  import WriteRefusalAlert from '$lib/components/agent-tasks/WriteRefusal.svelte';
  import TaskWarnings from '$lib/components/agent-tasks/TaskWarnings.svelte';
  import { warningsBelow, type TaskWarning } from '$lib/agent-tasks/warnings';
  import { cadenceText, isKnownReason, isWellFormedReasons, reasonHelp, reasonLabel } from '$lib/tickers/format';
  import { WRITABLE_REASONS } from '$lib/tickers/write';
  import type { Ticker } from '$lib/tickers/types';

  let {
    appId,
    ticker = null,
    impersonating = null,
    createAction = '?/create',
    reload = () => invalidateAll(),
  }: {
    appId: string;
    /** The ticker to edit; null creates one. */
    ticker?: Pick<Ticker, 'id' | 'name' | 'cadenceSeconds' | 'reasons'> | null;
    impersonating?: string | null;
    /** The form action that creates; a host that is not the Tickers page names its own. */
    createAction?: string;
    /** Reads the host's data again after a write. Defaults to the page load. */
    reload?: () => Promise<unknown>;
  } = $props();

  const editing = $derived(ticker !== null);
  const formId = $derived(ticker ? `ticker-edit-${ticker.id}` : 'ticker-create');

  // A ticker whose reasons this build can't show keeps them: the form never
  // offers (or sends) a set it would have to guess at.
  const reasonsEditable = $derived(
    !ticker || (isWellFormedReasons(ticker.reasons) && ticker.reasons.every(isKnownReason)),
  );
  const storedReasons = $derived<string[]>(
    ticker ? (isWellFormedReasons(ticker.reasons) ? ticker.reasons : []) : ['READ_TEAM_CHANNEL'],
  );
  const storedName = $derived(ticker?.name ?? '');
  const storedCadence = $derived(ticker ? String(ticker.cadenceSeconds) : '');

  // What the reader typed; undefined shows the stored value.
  let typedName = $state<string | undefined>(undefined);
  let typedCadence = $state<string | undefined>(undefined);
  let typedReasons = $state<string[] | undefined>(undefined);
  let submitting = $state(false);
  let refusal = $state<WriteRefusal | null>(null);
  let created = $state<{ id: string; name: string } | null>(null);
  // portal#1384 acceptance 9: what a create's response said besides "created" (ticker.code.unmapped, hadron-server#2733).
  let warnings = $state<TaskWarning[]>([]);
  let moreWarnings = $state(0);
  let status = $state<string | null>(null);
  let statusLine = $state<HTMLElement | null>(null);

  const name = $derived(typedName ?? storedName);
  const cadence = $derived(typedCadence ?? storedCadence);
  const reasons = $derived(typedReasons ?? storedReasons);
  const cadenceHint = $derived(/^\d+$/.test(cadence.trim()) && Number(cadence) > 0 ? cadenceText(Number(cadence)) : null);

  // `generation` fences a result that lands late: each submit takes a number, a
  // different ticker or App takes the next, and a stale result touches nothing.
  let generation = 0;
  let seededFor = $state<string | null>(null);
  $effect.pre(() => {
    const key = `${appId}:${ticker?.id ?? ''}`;
    if (seededFor !== key) {
      generation++;
      typedName = typedCadence = typedReasons = undefined;
      refusal = null;
      created = null;
      warnings = [];
      moreWarnings = 0;
      status = null;
      submitting = false;
      seededFor = key;
    }
  });

  // Leaving the page ends every pending write's right to touch it (Juliet's P2 on #1458).
  onDestroy(() => {
    generation++;
  });

  function toggle(reason: string, on: boolean) {
    const next = new Set(reasons);
    if (on) next.add(reason);
    else next.delete(reason);
    typedReasons = WRITABLE_REASONS.filter((r) => next.has(r));
  }

  function submitter() {
    return () => {
      const mine = ++generation;
      submitting = true;
      // portal#1463: a new submit answers for itself, so the last refusal (and the aria-invalid it set) goes.
      refusal = null;
      // What this write sends; input typed while it is in flight is the reader's next draft.
      const sentName = typedName;
      const sentCadence = typedCadence;
      const sentReasons = typedReasons;
      status = null;
      created = null;
      warnings = [];
      moreWarnings = 0;
      return async ({ result }: { result: { type: string; data?: Record<string, unknown> } }) => {
        if (mine !== generation) return;
        submitting = false;
        if (result.type === 'success') {
          const data = result.data && typeof result.data === 'object' ? result.data : {};
          const made = data.ticker as { id: string; name: string } | null | undefined;
          const committedWithError = data.committedWithError === true;
          await reload();
          if (mine !== generation) return;
          // Show the stored values, except where the reader has typed since the submit: that is theirs.
          const keptDraft = typedName !== sentName || typedCadence !== sentCadence || typedReasons !== sentReasons;
          if (typedName === sentName) typedName = undefined;
          if (typedCadence === sentCadence) typedCadence = undefined;
          if (typedReasons === sentReasons) typedReasons = undefined;
          refusal = null;
          warnings = Array.isArray(data.warnings) ? (data.warnings as TaskWarning[]) : [];
          moreWarnings = typeof data.more === 'number' ? data.more : 0;
          if (made) created = made;
          if (committedWithError) {
            status = t('app.tickers.write.created-error', 'Ticker created, but the server’s response also reported an error.');
          } else if (made) {
            status = t('app.tickers.write.created', 'Created {name}.', { name: made.name });
          } else if (!editing) {
            // A create a warning proved landed, though no ticker came back to link to.
            status = t('app.tickers.write.created-nolink', 'Ticker created.');
          } else {
            // A draft typed while this was saving stays on screen: the fields are then NOT the stored values.
            status = keptDraft
              ? t('app.tickers.write.saved-draft', 'Saved. Your newer changes are not saved yet.')
              : t('app.tickers.write.saved', 'Saved. These are the stored values.');
          }
          await tick();
          statusLine?.focus();
          return;
        }
        refusal =
          result.type === 'failure' && result.data && typeof result.data === 'object' && 'refusal' in result.data
            ? (result.data.refusal as WriteRefusal)
            : { kind: 'uncertain' };
        if (refusal.kind === 'invalid' && refusal.field !== 'form') {
          await tick();
          document.getElementById(`${formId}-${refusal.field}`)?.focus();
        }
      };
    };
  }

  const invalidField = (f: string) => (refusal?.kind === 'invalid' && refusal.field === f ? 'true' : undefined);
</script>

{#if impersonating}
  <p class="text-xs text-zinc-500 dark:text-zinc-400">
    {t('app.tasks.write.impersonating', 'Viewing as {name}: changes are switched off in a support session.', { name: impersonating })}
  </p>
{:else}
  <form
    method="POST"
    action={editing ? '?/update' : createAction}
    use:enhance={submitter()}
    class="space-y-3 rounded-xl border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900"
    data-testid={formId}
  >
    <div class="min-w-0">
      <label for="{formId}-name" class="font-medium text-zinc-900 dark:text-white">{t('app.tickers.write.name', 'Name')}</label>
      <input type="hidden" name="nameWas" value={storedName} />
      <input
        id="{formId}-name"
        name="name"
        type="text"
        autocomplete="off"
        value={name}
        oninput={(e) => (typedName = e.currentTarget.value)}
        aria-invalid={invalidField('name')}
        class="mt-1 block w-40 rounded-md border border-zinc-300 bg-white px-2 py-1 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-white"
      />
    </div>

    <div class="min-w-0">
      <label for="{formId}-cadenceSeconds" class="font-medium text-zinc-900 dark:text-white">{t('app.tickers.write.cadence', 'Every (seconds)')}</label>
      <input type="hidden" name="cadenceSecondsWas" value={storedCadence} />
      <input
        id="{formId}-cadenceSeconds"
        name="cadenceSeconds"
        type="text"
        inputmode="numeric"
        autocomplete="off"
        value={cadence}
        oninput={(e) => (typedCadence = e.currentTarget.value)}
        aria-describedby="{formId}-cadence-help"
        aria-invalid={invalidField('cadenceSeconds')}
        class="mt-1 block w-40 rounded-md border border-zinc-300 bg-white px-2 py-1 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-white"
      />
      <p id="{formId}-cadence-help" class="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
        {t('app.tickers.write.cadence.help', 'Whole seconds. The App sets how fast a ticker may be, and the server refuses one outside it.')}
        {#if cadenceHint}<span class="font-medium">{t('app.tickers.write.cadence.reads', 'Reads as every {every}.', { every: cadenceHint })}</span>{/if}
      </p>
    </div>

    {#if reasonsEditable}
      <fieldset class="min-w-0" aria-describedby="{formId}-reasons-help">
        <legend id="{formId}-reasons" tabindex="-1" class="font-medium text-zinc-900 dark:text-white">{t('app.tickers.write.reasons', 'When should the ticker send a message?')}</legend>
        <input type="hidden" name="reasonsShown" value="1" />
        <input type="hidden" name="reasonsWas" value={editing ? storedReasons.join(',') : ''} />
        <ul class="mt-1 space-y-2">
          {#each WRITABLE_REASONS as r (r)}
            <li class="flex items-start gap-2">
              <input
                id="{formId}-reason-{r}"
                type="checkbox"
                name="reasons"
                value={r}
                checked={reasons.includes(r)}
                onchange={(e) => toggle(r, e.currentTarget.checked)}
                aria-describedby="{formId}-reason-{r}-help"
                class="mt-0.5"
              />
              <div class="min-w-0">
                <label for="{formId}-reason-{r}" class="font-medium text-zinc-900 dark:text-white">{reasonLabel(r)}</label>
                <p id="{formId}-reason-{r}-help" class="text-xs text-zinc-600 dark:text-zinc-400">{reasonHelp(r)}</p>
              </div>
            </li>
          {/each}
        </ul>
        <p id="{formId}-reasons-help" class="mt-1 text-xs text-zinc-600 dark:text-zinc-400">{t('app.ticker.reasons.any-of', 'Any one of these wakes a subscriber.')} {t('app.tickers.write.reasons.required', 'Choose at least one.')}</p>
      </fieldset>
    {:else}
      <p class="text-xs text-zinc-600 dark:text-zinc-400">{t('app.tickers.write.reasons.locked', 'This ticker has a reason this page can’t show, so its reasons are left as they are.')}</p>
    {/if}

    {#if refusal}<WriteRefusalAlert {refusal} />{/if}
    <LiveRegion>
      {#if status}
        <p bind:this={statusLine} tabindex="-1" class="text-sm font-medium text-green-700 dark:text-green-300">
          {[status, warningsBelow(warnings.length + moreWarnings)].filter(Boolean).join(' ')}
          {#if created}<a href="/app/apps/{appId}/tickers/{created.id}" class="ml-1 underline">{t('app.tickers.write.open', 'Open it')}</a>{/if}
        </p>
      {/if}
    </LiveRegion>
    <TaskWarnings warnings={warnings} more={moreWarnings} />
    <button type="submit" disabled={submitting} class="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50">
      {#if submitting}{t('app.tickers.write.saving', 'Saving…')}{:else if editing}{t('app.tickers.write.save', 'Save')}{:else}{t('app.tickers.write.create', 'Create')}{/if}
    </button>
  </form>
{/if}
