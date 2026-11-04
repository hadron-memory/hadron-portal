<!--
  portal#1607 — the App's task integrations (hrn:node:hadronmemory.com:specs:cor:agt:120:01), on the Settings tab.

  The user wants to choose which repositories, labels and team leads the App's
  tasks are drawn from. Keyed on `propertiesRevision` (null = may not read: no
  section) and `viewerManages` (edit controls). The write replaces the whole
  `taskIntegrations` list (setAppProperties, V34); a team whose lead is no
  longer a live worker is shown as such and never dropped or sent as null.
-->
<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import type { SubmitFunction } from '@sveltejs/kit';
  import Urn from '$lib/components/Urn.svelte';
  import { t } from '$lib/i18n/t';
  import type { Worker } from '$lib/types';
  import type { PropertiesRead } from '$lib/server/app-properties';
  import {
    MAX_REPOSITORIES,
    TASK_INTEGRATION_PROVIDERS,
    blankIntegration,
    isUnsupported,
    leadStatus,
    readIntegrations,
    validateDrafts,
    type IntegrationDraft,
    type UnsupportedEntry,
    type LeadStatus,
    type TaskIntegrationsResult,
  } from '$lib/task-integrations';

  let { read, manages, workers }: {
    read: PropertiesRead;
    /** `App.viewerManages`: true / false, or null when unknown (failed read). */
    manages: boolean | null;
    /** The App's staff from WORKERS_QUERY (retired included); null when that read failed. */
    workers: Worker[] | null;
  } = $props();

  const inputClass = 'w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 pointer-coarse:min-h-11 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500';
  const buttonClass = 'rounded-md border border-zinc-300 px-3 py-1 text-xs text-zinc-600 pointer-coarse:min-h-11 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800';
  const errorClass = 'mt-1 text-xs text-red-600 dark:text-red-400';

  // portal#1678: the exact strings are the specs engineer's scoped FIT (hrn:node:hadronmemory.com:specs:cor:agt:120:01, Decided). One
  // t() call each, shared by the list and the form; no dispatch wording, no suffix.
  const readyHelp = $derived(t('app.integrations.ready-label-help', 'Marks items as ready for a team to work on. A search for untracked items can show only these items, or leave them out.'));
  const excludedHelp = $derived(t('app.integrations.excluded-labels-help', "Items with any of these labels are left out of the untracked items, so they can't be claimed from there."));
  const helpClass = 'mt-1 text-xs text-zinc-500 dark:text-zinc-400';

  const roster = $derived(workers ?? []);
  const liveWorkers = $derived(roster.filter((w) => !w.retiredAt));
  const entries = $derived(read.kind === 'ok' ? readIntegrations(read.properties) : []);
  // portal#1679: an entry this portal can't represent stays visible, blocks editing, and is removed only on purpose.
  // A removal is staged here and takes effect in the next save; nothing is sent until then. A staged removal is consent for
  // one row of ONE revision: it names a position, so it only counts while the list is still the revision it was confirmed
  // against. A refresh that replaces the list drops it (and an open "Remove entry?" question), so consent is never carried
  // over to a row the person did not see. Review of #1695, LOCAL P2-1, BLIND P2, security P2-1.
  const revision = $derived(read.kind === 'ok' ? read.revision : null);
  let stagedRevision = $state<number | null>(null);
  let stagedRemoved = $state<number[]>([]);
  let stagedConfirming = $state<number | null>(null);
  const removed = $derived(stagedRevision === revision ? stagedRemoved : []);
  const confirming = $derived(stagedRevision === revision ? stagedConfirming : null);
  // Staging against a newer revision starts from nothing.
  function restage() {
    if (stagedRevision !== revision) { stagedRemoved = []; stagedConfirming = null; stagedRevision = revision; }
  }
  function clearStaged() { stagedRemoved = []; stagedConfirming = null; }
  const shown = $derived(entries.filter((e) => !(isUnsupported(e) && removed.includes(e.index))));
  const saved = $derived(shown.filter((e): e is IntegrationDraft => !isUnsupported(e)));
  const blocked = $derived(shown.some(isUnsupported));
  const canEdit = $derived(read.kind === 'ok' && manages !== false && workers !== null);
  const providerLabel = (p: string) => (p === 'github' ? 'GitHub' : p);

  let editing = $state(false);
  let drafts = $state<IntegrationDraft[]>([]);
  let errors = $state<Record<string, string>>({});
  let formError = $state<string | null>(null);
  let conflict = $state(false);
  let pending = $state(false);
  // The revision the OPEN draft was taken from. The hidden field posts this, never the live read:
  // a loader refresh that lands mid-edit must not bless an old draft with a newer revision
  // (the server then refuses it as APP_PROPERTIES_CONFLICT). Review of #1614, LOCAL P2-1.
  let baseRevision = $state<number | null>(null);
  // One epoch per editing session: a response from an earlier session (Cancel, a new Edit, or an
  // unmounted section) must never act on a newer one. Review of #1614, LOCAL P2-3.
  let epoch = 0;
  onDestroy(() => { epoch++; });
  let formEl = $state<HTMLFormElement>();
  let headingEl = $state<HTMLHeadingElement>();
  let bannerEl = $state<HTMLDivElement>();
  let sectionEl = $state<HTMLElement>();

  // Mode changes unmount the button that had focus; put it somewhere a keyboard
  // or screen-reader user can carry on from (UX review of #1614, P2-1/P2-2).
  async function focusName(i: number) {
    await tick();
    formEl?.querySelector<HTMLInputElement>(`[data-integration-form="${i}"] input[type="text"]`)?.focus();
  }
  async function focusFirstProblem() {
    await tick();
    (formEl?.querySelector<HTMLElement>('[aria-invalid="true"], p[role="alert"]') ?? bannerEl)?.focus();
  }
  async function focusHeading() {
    await tick();
    headingEl?.focus();
  }
  // The three remove steps each unmount the button that had focus: hand it to the control that carries on from there
  // (UX review of #1695, P2).
  async function focusStep(selector: string) {
    await tick();
    (sectionEl?.querySelector<HTMLElement>(selector) ?? headingEl)?.focus();
  }
  function askRemove(index: number) { restage(); stagedConfirming = index; focusStep(`[data-unsupported="${index}"] [data-step="confirm"]`); }
  function confirmRemove(index: number) { restage(); stagedRemoved = [...stagedRemoved, index]; stagedConfirming = null; focusStep('[data-removal-pending] button'); }
  function keepEntry(index: number) { stagedConfirming = null; focusStep(`[data-unsupported="${index}"] [data-step="remove"]`); }
  function undoRemovals() { clearStaged(); focusHeading(); }


  function startEdit(addOne: boolean) {
    epoch++; pending = false;
    baseRevision = read.kind === 'ok' ? read.revision : null;
    drafts = $state.snapshot(saved) as IntegrationDraft[];
    if (addOne) drafts.push(blankIntegration());
    errors = {}; formError = null; conflict = false;
    editing = true;
    focusName(addOne ? drafts.length - 1 : 0);
  }
  function addIntegration() { drafts.push(blankIntegration()); focusName(drafts.length - 1); }
  function cancel() { epoch++; pending = false; editing = false; errors = {}; formError = null; conflict = false; clearStaged(); focusHeading(); }
  async function reload() {
    const mine = epoch;
    await invalidateAll();
    // A Cancel or a new Edit while the reload was in flight is a newer session: leave it alone
    // (LOCAL delta review of #1614, P2).
    if (mine === epoch) cancel();
  }

  const submit: SubmitFunction = ({ cancel: stop }) => {
    if (read.kind !== 'ok' || baseRevision === null || pending) { stop(); return; }
    const local = validateDrafts(drafts);
    if (Object.keys(local).length) { errors = local; formError = null; stop(); focusFirstProblem(); return; }
    const mine = epoch;
    pending = true; errors = {}; formError = null; conflict = false;
    return async ({ result }) => {
      if (mine !== epoch) {
        // A response for a session that is over: it may refresh the saved list, never the open editor.
        if (result.type === 'success' && (result.data as { taskIntegrationsResult?: TaskIntegrationsResult } | undefined)?.taskIntegrationsResult?.ok) await invalidateAll();
        return;
      }
      pending = false;
      const answer = result.type === 'success' ? (result.data as { taskIntegrationsResult?: TaskIntegrationsResult } | undefined)?.taskIntegrationsResult : undefined;
      if (!answer) { formError = t('app.integrations.error.unconfirmed', 'The save was not confirmed. Reload before trying again.'); focusFirstProblem(); return; }
      if (answer.ok) { await invalidateAll(); if (mine === epoch) cancel(); return; }
      if (answer.code === 'APP_PROPERTIES_CONFLICT') { conflict = true; formError = answer.message; focusFirstProblem(); return; }
      const bare = answer.path?.match(/^taskIntegrations\[(\d+)\](?:\.teams\[(\d+)\])?$/);
      if (answer.path && bare) {
        // portal#1679 R1/R2: a refusal at an entry or team itself has no field of its own. Show a fixed message at
        // that entry or team (never the server's words), or in the banner when it isn't on screen.
        const i = Number(bare[1]);
        const j = bare[2] === undefined ? null : Number(bare[2]);
        const onScreen = i < drafts.length && (j === null || j < drafts[i].teams.length);
        const fixed = j === null
          ? t('app.integrations.error.entry-refused', 'The server refused this integration. Check its fields and try again.')
          : t('app.integrations.error.team-refused', 'The server refused this team. Check its lead and label and try again.');
        if (onScreen) errors = { [answer.path]: fixed };
        else formError = fixed;
      } else if (answer.path && answer.path.startsWith('taskIntegrations[')) errors = { [answer.path]: answer.message };
      else formError = answer.message;
      focusFirstProblem();
    };
  };

  type NamedLead = Exclude<LeadStatus, { kind: 'unknown' }>;
  function leadName(s: NamedLead): string {
    if (s.kind === 'missing') return t('app.integrations.lead.missing', 'Worker not in this App’s list');
    if (s.kind === 'unchecked') return t('app.integrations.lead.unchecked', 'Couldn’t check this worker');
    return s.name;
  }
  function leadNote(s: NamedLead): string | null {
    if (s.kind === 'retired') return t('app.integrations.lead.retired', 'No longer a live worker');
    if (s.kind === 'missing') return t('app.integrations.lead.missing-note', 'Can’t confirm it is still live.');
    if (s.kind === 'unchecked') return t('app.integrations.lead.unchecked-note', 'The worker list didn’t load, so we can’t tell if it is still live.');
    return null;
  }

  const hasListError = (path: string) => Object.keys(errors).some((k) => k === path || k.startsWith(`${path}[`));
  const field = (path: string) => `ti-${path.replace(/[^a-z0-9]+/gi, '-').replace(/-$/, '')}`;
  // The help id, when the field has one, is merged with the error id, never swapped for it.
  const describedBy = (path: string, help?: string) => [help, errors[path] ? `${field(path)}-error` : undefined].filter(Boolean).join(' ') || undefined;

  function pickLead(i: number, j: number, value: string) {
    drafts[i].teams[j].lead = value === '' ? null : value;
    delete errors[`taskIntegrations[${i}].teams[${j}].lead`];
  }
</script>

{#snippet lead(urn: string | null)}
  {@const s = leadStatus(urn, workers)}
  {#if s.kind === 'unknown'}
    <span class="text-amber-700 dark:text-amber-400">{t('app.integrations.lead.unknown', 'Unknown worker')}</span>
  {:else}
    {@const note = leadNote(s)}
    <span class="text-zinc-900 dark:text-zinc-100">{leadName(s)}</span>
    {#if note}
      <span class="ml-1 text-amber-700 dark:text-amber-400">{note}</span>
    {/if}
    <div class="mt-1"><Urn value={s.urn} size={10} compact /></div>
  {/if}
{/snippet}

{#if read.kind !== 'hidden'}
  <section bind:this={sectionEl} class="max-w-2xl" aria-labelledby="task-integrations-heading" data-task-integrations>
    <div class="mb-4 flex items-center justify-between">
      <h2 id="task-integrations-heading" bind:this={headingEl} tabindex="-1" class="font-semibold focus:outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 text-zinc-900 dark:text-white">{t('app.integrations.heading', 'Task integrations')}</h2>
      {#if canEdit && !editing && !blocked}
        <div class="flex gap-2">
          {#if saved.length || removed.length}<button type="button" class={buttonClass} onclick={() => startEdit(false)}>{t('app.integrations.edit', 'Edit')}</button>{/if}
          <button type="button" class={buttonClass} onclick={() => startEdit(true)}>{t('app.integrations.add', 'Add integration')}</button>
        </div>
      {/if}
    </div>

    {#if read.kind === 'failed'}
      <p role="alert" class="text-sm text-red-600 dark:text-red-400">{t('app.integrations.load-failed', 'The task integrations could not be loaded.')}</p>
    {:else if !editing}
      {#if canEdit && blocked}
        <p data-unsupported-notice class="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
          {t('app.integrations.unsupported-notice', 'This list holds an entry this portal can’t edit, so editing is off. Remove that entry here, or change it with a client that supports it.')}
        </p>
      {/if}
      {#if canEdit && removed.length}
        <p data-removal-pending class="mb-3 text-sm text-zinc-600 dark:text-zinc-400">
          {t('app.integrations.removal-pending', 'The removal isn’t saved yet. Edit and save to apply it.')}
          <button type="button" class="ml-2 underline pointer-coarse:min-h-11" onclick={undoRemovals}>{removed.length > 1 ? t('app.integrations.undo-removals', 'Undo all {n} removals', { n: removed.length }) : t('app.integrations.undo-removal', 'Undo removal')}</button>
        </p>
      {/if}
      {#if shown.length === 0}
        <p class="text-sm text-zinc-500 dark:text-zinc-400">{t('app.integrations.none', 'None configured')}</p>
      {:else}
        <ul class="space-y-3">
          {#each shown as entry, i (i)}
            {#if isUnsupported(entry)}
              {@const u: UnsupportedEntry = entry}
              <li class="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-800 dark:bg-amber-950" data-unsupported={u.index}>
                <div class="flex flex-wrap items-baseline gap-2">
                  <span class="font-medium text-zinc-900 dark:text-white">{t('app.integrations.unsupported', 'Unsupported entry')}</span>
                  <span class="text-xs text-zinc-600 dark:text-zinc-400">{t('app.integrations.unsupported-position', 'Entry {n}', { n: u.index + 1 })}{#if u.provider !== null}{' · '}{u.provider}{/if}</span>
                </div>
                {#if canEdit}
                  {#if confirming === u.index}
                    <p class="mt-2 text-zinc-700 dark:text-zinc-300">{t('app.integrations.remove-entry-confirm', 'Remove entry {n}? It is deleted when you save the integrations.', { n: u.index + 1 })}</p>
                    <div class="mt-2 flex gap-2">
                      <button type="button" class={buttonClass} data-step="confirm" onclick={() => confirmRemove(u.index)}>{t('app.integrations.confirm-remove-entry', 'Confirm remove')}</button>
                      <button type="button" class={buttonClass} onclick={() => keepEntry(u.index)}>{t('app.integrations.keep-entry', 'Keep entry')}</button>
                    </div>
                  {:else}
                    <div class="mt-2">
                      <button type="button" class={buttonClass} data-step="remove" aria-label={t('app.integrations.remove-entry-n', 'Remove entry {n}', { n: u.index + 1 })} onclick={() => askRemove(u.index)}>{t('app.integrations.remove-entry', 'Remove entry')}</button>
                    </div>
                  {/if}
                {/if}
              </li>
            {:else}
            {@const d = entry}
            <li class="rounded-xl border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900" data-integration={d.name}>
              <div class="flex items-baseline gap-2">
                <span class="font-medium text-zinc-900 dark:text-white">{d.name}</span>
                <span class="text-xs text-zinc-500 dark:text-zinc-400">{d.provider}</span>
              </div>
              <dl class="mt-2 grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5">
                <dt class="text-zinc-500 dark:text-zinc-400">{t('app.integrations.repositories', 'Repositories')}</dt>
                <dd class="min-w-0 break-words">{d.repositories.join(', ')}</dd>
                {#if d.readyLabel}
                  <dt class="text-zinc-500 dark:text-zinc-400">{t('app.integrations.ready-label', 'Ready label')}</dt>
                  <dd>{d.readyLabel}<p class={helpClass}>{readyHelp}</p></dd>
                {/if}
                {#if d.excludeLabels.length}
                  <dt class="text-zinc-500 dark:text-zinc-400">{t('app.integrations.excluded-labels', 'Excluded labels')}</dt>
                  <dd>{d.excludeLabels.join(', ')}<p class={helpClass}>{excludedHelp}</p></dd>
                {/if}
                {#each d.teams as team}
                  <dt class="text-zinc-500 dark:text-zinc-400">{t('app.integrations.team', 'Team')}</dt>
                  <dd class="min-w-0" data-team-label={team.label}>
                    <div>{team.label}</div>
                    <div class="mt-1 text-xs">{@render lead(team.lead)}</div>
                  </dd>
                {/each}
              </dl>
            </li>
            {/if}
          {/each}
        </ul>
      {/if}
    {:else}
      <form bind:this={formEl} method="POST" action="?/saveTaskIntegrations" use:enhance={submit} novalidate class="space-y-4">
        <input type="hidden" name="integrations" value={JSON.stringify(drafts)} />
        <input type="hidden" name="revision" value={baseRevision ?? ''} />
        {#if formError}
          <div role="alert" tabindex="-1" bind:this={bannerEl} class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
            {formError}
            {#if conflict}<button type="button" class="ml-2 inline-flex items-center underline pointer-coarse:min-h-11" onclick={reload}>{t('app.integrations.reload', 'Reload (discards your changes)')}</button>{/if}
          </div>
        {/if}

        {#each drafts as d, i (i)}
          {@const at = `taskIntegrations[${i}]`}
          <fieldset class="min-w-0 space-y-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900" data-integration-form={i}>
            <legend class="px-1 text-xs text-zinc-500 dark:text-zinc-400">{d.name.trim() || t('app.integrations.new', 'New integration')}</legend>
            {#if errors[at]}<p role="alert" tabindex="-1" class={errorClass}>{errors[at]}</p>{/if}

            <div>
              <label for={field(`${at}.name`)} class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('app.integrations.name', 'Name')}</label>
              <input id={field(`${at}.name`)} type="text" bind:value={d.name} aria-invalid={!!errors[`${at}.name`]} aria-describedby={describedBy(`${at}.name`)} class="{inputClass} {errors[`${at}.name`] ? 'border-red-500' : ''}" />
              {#if errors[`${at}.name`]}<p id="{field(`${at}.name`)}-error" role="alert" class={errorClass}>{errors[`${at}.name`]}</p>{/if}
            </div>

            <div>
              <label for={field(`${at}.provider`)} class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('app.integrations.provider', 'Provider')}</label>
              <select id={field(`${at}.provider`)} bind:value={d.provider} class={inputClass}>
                {#each TASK_INTEGRATION_PROVIDERS as p (p)}
                  <option value={p}>{providerLabel(p)}</option>
                {/each}
              </select>
            </div>

            <div>
              <span class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300" id={field(`${at}.repositories`)}>{t('app.integrations.repositories', 'Repositories')}</span>
              <div role="group" aria-labelledby={field(`${at}.repositories`)} class="space-y-2">
                {#each d.repositories as _, j (j)}
                  {@const p = `${at}.repositories[${j}]`}
                  <div>
                    <div class="flex gap-2">
                      <input id={field(p)} type="text" bind:value={d.repositories[j]} placeholder="owner/name" aria-label={t('app.integrations.repository-n', 'Repository {n}', { n: j + 1 })} aria-invalid={!!errors[p]} aria-describedby={describedBy(p)} class="{inputClass} {errors[p] ? 'border-red-500' : ''}" />
                      <button type="button" class={buttonClass} aria-label={t('app.integrations.remove-repository-n', 'Remove repository {n}', { n: j + 1 })} onclick={() => d.repositories.splice(j, 1)}>{t('app.integrations.remove', 'Remove')}</button>
                    </div>
                    {#if errors[p]}<p id="{field(p)}-error" role="alert" class={errorClass}>{errors[p]}</p>{/if}
                  </div>
                {/each}
              </div>
              {#if errors[`${at}.repositories`]}<p role="alert" tabindex="-1" class={errorClass}>{errors[`${at}.repositories`]}</p>{/if}
              <button type="button" class="{buttonClass} mt-2" disabled={d.repositories.length >= MAX_REPOSITORIES} onclick={() => d.repositories.push('')}>{t('app.integrations.add-repository', 'Add repository')}</button>
            </div>

            <div>
              <label for={field(`${at}.readyLabel`)} class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('app.integrations.ready-label', 'Ready label')}</label>
              <input id={field(`${at}.readyLabel`)} type="text" bind:value={d.readyLabel} aria-invalid={!!errors[`${at}.readyLabel`]} aria-describedby={describedBy(`${at}.readyLabel`, `${field(`${at}.readyLabel`)}-help`)} class="{inputClass} {errors[`${at}.readyLabel`] ? 'border-red-500' : ''}" />
              <p id="{field(`${at}.readyLabel`)}-help" class={helpClass}>{readyHelp}</p>
              {#if errors[`${at}.readyLabel`]}<p id="{field(`${at}.readyLabel`)}-error" role="alert" class={errorClass}>{errors[`${at}.readyLabel`]}</p>{/if}
            </div>

            <div>
              <span class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300" id={field(`${at}.excludeLabels`)}>{t('app.integrations.excluded-labels', 'Excluded labels')}</span>
              <p id="{field(`${at}.excludeLabels`)}-help" class="mb-2 text-xs text-zinc-500 dark:text-zinc-400">{excludedHelp}</p>
              <div role="group" aria-labelledby={field(`${at}.excludeLabels`)} aria-describedby="{field(`${at}.excludeLabels`)}-help" class="space-y-2">
                {#each d.excludeLabels as _, j (j)}
                  {@const p = `${at}.excludeLabels[${j}]`}
                  <div>
                    <div class="flex gap-2">
                      <input id={field(p)} type="text" bind:value={d.excludeLabels[j]} aria-label={t('app.integrations.excluded-label-n', 'Excluded label {n}', { n: j + 1 })} aria-invalid={!!errors[p]} aria-describedby={describedBy(p)} class="{inputClass} {errors[p] ? 'border-red-500' : ''}" />
                      <button type="button" class={buttonClass} aria-label={t('app.integrations.remove-excluded-label-n', 'Remove excluded label {n}', { n: j + 1 })} onclick={() => d.excludeLabels.splice(j, 1)}>{t('app.integrations.remove', 'Remove')}</button>
                    </div>
                    {#if errors[p]}<p id="{field(p)}-error" role="alert" class={errorClass}>{errors[p]}</p>{/if}
                  </div>
                {/each}
              </div>
              <button type="button" class="{buttonClass} mt-2" onclick={() => d.excludeLabels.push('')}>{t('app.integrations.add-excluded-label', 'Add excluded label')}</button>
            </div>

            <div>
              <span class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300" id={field(`${at}.teams`)}>{t('app.integrations.teams', 'Teams')}</span>
              <div role="group" aria-labelledby={field(`${at}.teams`)} class="space-y-3">
                {#each d.teams as team, j (j)}
                  {@const lp = `${at}.teams[${j}].lead`}
                  {@const tp = `${at}.teams[${j}].label`}
                  {@const s = leadStatus(team.lead, workers)}
                  <div class="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800" data-team={j}>
                    {#if errors[`${at}.teams[${j}]`]}<p role="alert" tabindex="-1" class="mb-2 {errorClass}">{errors[`${at}.teams[${j}]`]}</p>{/if}
                    <label for={field(lp)} class="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">{t('app.integrations.lead', 'Lead')}</label>
                    <select id={field(lp)} value={team.lead ?? ''} onchange={(e) => pickLead(i, j, e.currentTarget.value)} aria-invalid={!!errors[lp]} aria-describedby={describedBy(lp)} class="{inputClass} {errors[lp] ? 'border-red-500' : ''}">
                      {#if s.kind === 'unknown'}
                        <option value="">{t('app.integrations.lead.unknown', 'Unknown worker')}</option>
                      {:else if s.kind !== 'live'}
                        <option value={s.urn}>{leadName(s)}</option>
                      {/if}
                      {#each liveWorkers as w (w.id)}
                        <option value={w.urn ?? w.id}>{w.name}</option>
                      {/each}
                    </select>
                    {#if s.kind !== 'unknown'}
                      {@const note = leadNote(s)}
                      <div class="mt-1 text-xs">
                        <Urn value={s.urn} size={10} compact />
                        {#if note}<p class="text-amber-700 dark:text-amber-400">{note}</p>{/if}
                      </div>
                    {/if}
                    {#if errors[lp]}<p id="{field(lp)}-error" role="alert" class={errorClass}>{errors[lp]}</p>{/if}

                    <label for={field(tp)} class="mt-3 mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">{t('app.integrations.team-label', 'Label')}</label>
                    <div class="flex gap-2">
                      <input id={field(tp)} type="text" bind:value={team.label} aria-invalid={!!errors[tp]} aria-describedby={describedBy(tp)} class="{inputClass} {errors[tp] ? 'border-red-500' : ''}" />
                      <button type="button" class={buttonClass} aria-label={t('app.integrations.remove-team-n', 'Remove team {label}', { label: team.label.trim() || String(j + 1) })} onclick={() => d.teams.splice(j, 1)}>{t('app.integrations.remove-team', 'Remove team')}</button>
                    </div>
                    {#if errors[tp]}<p id="{field(tp)}-error" role="alert" class={errorClass}>{errors[tp]}</p>{/if}
                  </div>
                {/each}
              </div>
              <button type="button" class="{buttonClass} mt-2" disabled={liveWorkers.length === 0} onclick={() => d.teams.push({ lead: liveWorkers[0] ? (liveWorkers[0].urn ?? liveWorkers[0].id) : null, label: '' })}>{t('app.integrations.add-team', 'Add team')}</button>
            </div>

            <div class="flex justify-end">
              <button type="button" class={buttonClass} aria-label={t('app.integrations.remove-integration-n', 'Remove integration {name}', { name: d.name.trim() || String(i + 1) })} onclick={() => drafts.splice(i, 1)}>{t('app.integrations.remove-integration', 'Remove integration')}</button>
            </div>
          </fieldset>
        {/each}

        <div class="flex flex-wrap items-center gap-2">
          <button type="button" class={buttonClass} onclick={addIntegration}>{t('app.integrations.add', 'Add integration')}</button>
          <span class="flex-1"></span>
          <button type="button" class={buttonClass} onclick={cancel}>{t('app.integrations.cancel', 'Cancel')}</button>
          <button type="submit" disabled={pending} class="rounded-md bg-indigo-600 px-3 py-1 text-xs font-medium text-white pointer-coarse:min-h-11 hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50">{t('app.integrations.save', 'Save')}</button>
        </div>
      </form>
    {/if}
  </section>
{/if}
