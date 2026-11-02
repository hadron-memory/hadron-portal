<!--
  portal#1609 (slice C of #1141) — the one form that adds an Agent ticker
  template and edits one. The user wants to name a ticker an Agent declares,
  say how often it ticks and what wakes a worker, and save it.

  - Shown only to a viewer the server says may edit (`viewerMayEditTickerTemplates`
    === true; the panel decides). That flag is a display hint: every save goes
    with the viewer's own token and the server's refusal is the answer.
  - Create sends name, cadence and an explicit reasons set. An edit sends only
    what changed, with the revision the page read (see buildTemplateUpdate).
    Reasons the form can't show are left alone; quiet hours can be removed
    (clearQuietHours), never set here. No client-side cadence range: a template
    has no App floor (hrn:node:hadronmemory.com:specs:cor:agt:080:33).
  - Nothing is optimistic or retried. A refusal keeps what was typed; a stale
    revision offers an explicit reload; a success reloads and shows the STORED
    values. An uncertain outcome is shown as uncertain.
-->
<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import { t } from '$lib/i18n/t';
  import type { WriteRefusal } from '$lib/agent-tasks/actions';
  import WriteRefusalAlert from '$lib/components/agent-tasks/WriteRefusal.svelte';
  import { isKnownReason, isWellFormedReasons, quietHoursSummary, reasonHelp, reasonLabel, cadenceText } from '$lib/tickers/format';
  import { WRITABLE_REASONS } from '$lib/tickers/write';
  import type { AgentTickerTemplate } from '$lib/tickers/types';

  let {
    agentId,
    template = null,
  }: {
    agentId: string;
    /** The template to edit; null adds one. */
    template?: Pick<AgentTickerTemplate, 'id' | 'name' | 'cadenceSeconds' | 'reasons' | 'quietHours' | 'revision'> | null;
  } = $props();

  const editing = $derived(template !== null);
  const formId = $derived(template ? `agent-template-edit-${template.id}` : 'agent-template-create');

  const reasonsEditable = $derived(!template || (isWellFormedReasons(template.reasons) && template.reasons.every(isKnownReason)));
  const storedReasons = $derived<string[]>(template ? (isWellFormedReasons(template.reasons) ? template.reasons : []) : ['READ_TEAM_CHANNEL']);
  const storedName = $derived(template?.name ?? '');
  const storedCadence = $derived(template ? String(template.cadenceSeconds) : '');
  const quietText = $derived(template && template.quietHours != null ? quietHoursSummary(template.quietHours) : null);

  let typedName = $state<string | undefined>(undefined);
  let typedCadence = $state<string | undefined>(undefined);
  let typedReasons = $state<string[] | undefined>(undefined);
  let clearQuiet = $state(false);
  let submitting = $state(false);
  let refusal = $state<WriteRefusal | null>(null);
  let status = $state<string | null>(null);
  let statusLine = $state<HTMLElement | null>(null);
  let reloading = $state(false);

  const name = $derived(typedName ?? storedName);
  const cadence = $derived(typedCadence ?? storedCadence);
  const reasons = $derived(typedReasons ?? storedReasons);
  const cadenceHint = $derived(/^\d+$/.test(cadence.trim()) && Number(cadence) > 0 ? cadenceText(Number(cadence)) : null);
  const stale = $derived(refusal?.kind === 'refused' && refusal.code === 'TICKER_TEMPLATE_REVISION_MISMATCH');

  // `generation` fences a result that lands late: each submit takes a number, a
  // different Agent or template takes the next, and a stale result touches nothing.
  let generation = 0;
  let seededFor = $state<string | null>(null);
  $effect.pre(() => {
    const key = `${agentId}:${template?.id ?? ''}`;
    if (seededFor !== key) {
      generation++;
      typedName = typedCadence = typedReasons = undefined;
      clearQuiet = false;
      refusal = null;
      status = null;
      submitting = false;
      seededFor = key;
    }
  });

  onDestroy(() => {
    generation++;
  });

  function toggle(reason: string, on: boolean) {
    const next = new Set(reasons);
    if (on) next.add(reason);
    else next.delete(reason);
    typedReasons = WRITABLE_REASONS.filter((r) => next.has(r));
  }

  async function reload() {
    reloading = true;
    try {
      await invalidateAll();
      refusal = null;
    } finally {
      reloading = false;
    }
  }

  function submitter() {
    return () => {
      const mine = ++generation;
      submitting = true;
      refusal = null;
      const sentName = typedName;
      const sentCadence = typedCadence;
      const sentReasons = typedReasons;
      status = null;
      return async ({ result }: { result: { type: string; data?: Record<string, unknown> } }) => {
        if (mine !== generation) return;
        submitting = false;
        if (result.type === 'success') {
          await invalidateAll();
          if (mine !== generation) return;
          const keptDraft = typedName !== sentName || typedCadence !== sentCadence || typedReasons !== sentReasons;
          if (typedName === sentName) typedName = undefined;
          if (typedCadence === sentCadence) typedCadence = undefined;
          if (typedReasons === sentReasons) typedReasons = undefined;
          clearQuiet = false;
          refusal = null;
          status = !editing
            ? t('agent.tickers.write.created', 'Added. It reaches workers cast from this Agent from now on.')
            : keptDraft
              ? t('agent.tickers.write.saved-draft', 'Saved. Your newer changes are not saved yet.')
              : t('agent.tickers.write.saved', 'Saved. These are the stored values.');
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

<form
  method="POST"
  action={editing ? '?/updateTickerTemplate' : '?/createTickerTemplate'}
  use:enhance={submitter()}
  class="space-y-3 rounded-xl border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900"
  data-testid={formId}
>
  {#if template}
    <input type="hidden" name="id" value={template.id} />
    <input type="hidden" name="expectedRevision" value={String(template.revision)} />
  {/if}

  <div class="min-w-0">
    <label for="{formId}-name" class="font-medium text-zinc-900 dark:text-white">{t('agent.tickers.write.name', 'Name')}</label>
    <input type="hidden" name="nameWas" value={storedName} />
    <input
      id="{formId}-name"
      name="name"
      type="text"
      autocomplete="off"
      value={name}
      oninput={(e) => (typedName = e.currentTarget.value)}
      aria-invalid={invalidField('name')}
      class="mt-1 block w-full max-w-sm rounded-md border border-zinc-300 bg-white px-2 py-1 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-white"
    />
  </div>

  <div class="min-w-0">
    <label for="{formId}-cadenceSeconds" class="font-medium text-zinc-900 dark:text-white">{t('agent.tickers.write.cadence', 'Every (seconds)')}</label>
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
      {t('agent.tickers.write.cadence.help', 'Whole seconds, at most a day. An App raises it to its own fastest rate when a worker is cast.')}
      {#if cadenceHint}<span class="font-medium">{t('agent.tickers.write.cadence.reads', 'Reads as every {every}.', { every: cadenceHint })}</span>{/if}
    </p>
  </div>

  {#if reasonsEditable}
    <fieldset class="min-w-0" aria-describedby="{formId}-reasons-help">
      <legend id="{formId}-reasons" tabindex="-1" class="font-medium text-zinc-900 dark:text-white">{t('agent.tickers.write.reasons', 'Wakes when')}</legend>
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
      <p id="{formId}-reasons-help" class="mt-1 text-xs text-zinc-600 dark:text-zinc-400">{t('agent.tickers.write.reasons.help', 'Any one of these wakes a worker. Choose at least one.')}</p>
    </fieldset>
  {:else}
    <p class="text-xs text-zinc-600 dark:text-zinc-400">{t('agent.tickers.write.reasons.locked', 'This template has a reason this page can’t show, so its reasons are left as they are.')}</p>
  {/if}

  {#if quietText}
    <div class="min-w-0">
      <p class="font-medium text-zinc-900 dark:text-white">{t('agent.tickers.write.quiet', 'Quiet hours')}</p>
      <p class="text-zinc-600 dark:text-zinc-400" data-testid="{formId}-quiet">{quietText}</p>
      <label class="mt-1 flex items-center gap-2 text-zinc-900 dark:text-white">
        <input type="checkbox" name="clearQuietHours" value="1" bind:checked={clearQuiet} />
        {t('agent.tickers.write.quiet.clear', 'Remove quiet hours')}
      </label>
    </div>
  {/if}

  <p class="text-xs text-zinc-600 dark:text-zinc-400">
    {t('agent.tickers.write.future', 'Changes reach only workers cast from this Agent afterwards. Tickers already made from a template are not changed.')}
  </p>

  {#if refusal}<WriteRefusalAlert {refusal} />{/if}
  {#if stale}
    <button type="button" onclick={reload} disabled={reloading} class="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
      {t('agent.tickers.write.reload', 'Reload latest')}
    </button>
  {/if}
  {#if status}
    <p bind:this={statusLine} tabindex="-1" role="status" aria-live="polite" class="text-sm font-medium text-green-700 dark:text-green-300">{status}</p>
  {/if}
  <button type="submit" disabled={submitting} class="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50">
    {#if submitting}{t('agent.tickers.write.saving', 'Saving…')}{:else if editing}{t('agent.tickers.write.save', 'Save')}{:else}{t('agent.tickers.write.add', 'Add')}{/if}
  </button>
</form>
