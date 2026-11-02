<!--
  portal#1607 — the App's task integrations (hrn:node:hadronmemory.com:specs:cor:agt:120:01), on the Settings tab.

  The user wants to choose which repositories, labels and team leads the App's
  tasks are drawn from. Keyed on `propertiesRevision` (null = may not read: no
  section) and `viewerManages` (edit controls). The write replaces the whole
  `taskIntegrations` list (setAppProperties, V34); a team whose lead is no
  longer a live worker is shown as such and never dropped or sent as null.
-->
<script lang="ts">
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import type { SubmitFunction } from '@sveltejs/kit';
  import Urn from '$lib/components/Urn.svelte';
  import { t } from '$lib/i18n/t';
  import type { Worker } from '$lib/types';
  import type { PropertiesRead } from '$lib/server/app-properties';
  import {
    MAX_REPOSITORIES,
    leadStatus,
    readIntegrations,
    validateDrafts,
    type IntegrationDraft,
    type TaskIntegrationsResult,
  } from '$lib/task-integrations';

  let { read, manages, workers }: {
    read: PropertiesRead;
    /** `App.viewerManages`: true / false, or null when unknown (failed read). */
    manages: boolean | null;
    /** The App's staff from WORKERS_QUERY (retired included); null when that read failed. */
    workers: Worker[] | null;
  } = $props();

  const inputClass = 'w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500';
  const buttonClass = 'rounded-md border border-zinc-300 px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800';
  const errorClass = 'mt-1 text-xs text-red-600 dark:text-red-400';

  const roster = $derived(workers ?? []);
  const liveWorkers = $derived(roster.filter((w) => !w.retiredAt));
  const saved = $derived(read.kind === 'ok' ? readIntegrations(read.properties) : []);
  const canEdit = $derived(read.kind === 'ok' && manages !== false && workers !== null);

  let editing = $state(false);
  let drafts = $state<IntegrationDraft[]>([]);
  let errors = $state<Record<string, string>>({});
  let formError = $state<string | null>(null);
  let conflict = $state(false);
  let pending = $state(false);

  const blank = (): IntegrationDraft => ({ name: '', provider: 'github', repositories: [''], readyLabel: '', excludeLabels: [], teams: [], extra: {} });

  function startEdit(addOne: boolean) {
    drafts = $state.snapshot(saved) as IntegrationDraft[];
    if (addOne) drafts.push(blank());
    errors = {}; formError = null; conflict = false;
    editing = true;
  }
  function cancel() { editing = false; errors = {}; formError = null; conflict = false; }
  async function reload() {
    await invalidateAll();
    cancel();
  }

  const submit: SubmitFunction = ({ cancel: stop }) => {
    if (read.kind !== 'ok' || pending) { stop(); return; }
    const local = validateDrafts(drafts);
    if (Object.keys(local).length) { errors = local; formError = null; stop(); return; }
    pending = true; errors = {}; formError = null; conflict = false;
    return async ({ result }) => {
      pending = false;
      const answer = result.type === 'success' ? (result.data as { taskIntegrationsResult?: TaskIntegrationsResult } | undefined)?.taskIntegrationsResult : undefined;
      if (!answer) { formError = t('app.integrations.error.unconfirmed', 'The save was not confirmed. Reload before trying again.'); return; }
      if (answer.ok) { await invalidateAll(); cancel(); return; }
      if (answer.code === 'APP_PROPERTIES_CONFLICT') { conflict = true; formError = answer.message; return; }
      if (answer.path && answer.path.startsWith('taskIntegrations[')) errors = { [answer.path]: answer.message };
      else formError = answer.message;
    };
  };

  const hasListError = (path: string) => Object.keys(errors).some((k) => k === path || k.startsWith(`${path}[`));
  const field = (path: string) => `ti-${path.replace(/[^a-z0-9]+/gi, '-').replace(/-$/, '')}`;
  const describedBy = (path: string) => (errors[path] ? `${field(path)}-error` : undefined);

  function pickLead(i: number, j: number, value: string) {
    drafts[i].teams[j].lead = value === '' ? null : value;
    delete errors[`taskIntegrations[${i}].teams[${j}].lead`];
  }
</script>

{#snippet lead(urn: string | null)}
  {@const s = leadStatus(urn, roster)}
  {#if s.kind === 'unknown'}
    <span class="text-amber-700 dark:text-amber-400">{t('app.integrations.lead.unknown', 'Unknown worker')}</span>
  {:else}
    <span class="text-zinc-900 dark:text-zinc-100">{s.name ?? s.urn}</span>
    {#if s.kind === 'retired'}
      <span class="ml-1 text-amber-700 dark:text-amber-400">{t('app.integrations.lead.retired', 'No longer a live worker')}</span>
    {/if}
    {#if s.name}<div class="mt-1"><Urn value={s.urn} size={10} compact /></div>{/if}
  {/if}
{/snippet}

{#if read.kind !== 'hidden'}
  <section class="max-w-2xl" aria-labelledby="task-integrations-heading" data-task-integrations>
    <div class="mb-4 flex items-center justify-between">
      <h2 id="task-integrations-heading" class="font-semibold text-zinc-900 dark:text-white">{t('app.integrations.heading', 'Task integrations')}</h2>
      {#if canEdit && !editing}
        <div class="flex gap-2">
          {#if saved.length}<button type="button" class={buttonClass} onclick={() => startEdit(false)}>{t('app.integrations.edit', 'Edit')}</button>{/if}
          <button type="button" class={buttonClass} onclick={() => startEdit(true)}>{t('app.integrations.add', 'Add integration')}</button>
        </div>
      {/if}
    </div>

    {#if read.kind === 'failed'}
      <p role="alert" class="text-sm text-red-600 dark:text-red-400">{t('app.integrations.load-failed', 'The task integrations could not be loaded.')}</p>
    {:else if !editing}
      {#if saved.length === 0}
        <p class="text-sm text-zinc-500 dark:text-zinc-400">{t('app.integrations.none', 'None configured')}</p>
      {:else}
        <ul class="space-y-3">
          {#each saved as d (d.name)}
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
                  <dd>{d.readyLabel}</dd>
                {/if}
                {#if d.excludeLabels.length}
                  <dt class="text-zinc-500 dark:text-zinc-400">{t('app.integrations.excluded-labels', 'Excluded labels')}</dt>
                  <dd>{d.excludeLabels.join(', ')}</dd>
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
          {/each}
        </ul>
      {/if}
    {:else}
      <form method="POST" action="?/saveTaskIntegrations" use:enhance={submit} novalidate class="space-y-4">
        <input type="hidden" name="integrations" value={JSON.stringify(drafts)} />
        <input type="hidden" name="revision" value={read.kind === 'ok' ? read.revision : ''} />
        {#if formError}
          <div role="alert" class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
            {formError}
            {#if conflict}<button type="button" class="ml-2 underline" onclick={reload}>{t('app.integrations.reload', 'Reload')}</button>{/if}
          </div>
        {/if}

        {#each drafts as d, i (i)}
          {@const at = `taskIntegrations[${i}]`}
          <fieldset class="space-y-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900" data-integration-form={i}>
            <legend class="px-1 text-xs text-zinc-500 dark:text-zinc-400">{d.name.trim() || t('app.integrations.new', 'New integration')}</legend>

            <div>
              <label for={field(`${at}.name`)} class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('app.integrations.name', 'Name')}</label>
              <input id={field(`${at}.name`)} type="text" bind:value={d.name} aria-invalid={!!errors[`${at}.name`]} aria-describedby={describedBy(`${at}.name`)} class="{inputClass} {errors[`${at}.name`] ? 'border-red-500' : ''}" />
              {#if errors[`${at}.name`]}<p id="{field(`${at}.name`)}-error" role="alert" class={errorClass}>{errors[`${at}.name`]}</p>{/if}
            </div>

            <div>
              <label for={field(`${at}.provider`)} class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('app.integrations.provider', 'Provider')}</label>
              <select id={field(`${at}.provider`)} bind:value={d.provider} class={inputClass}>
                <option value="github">GitHub</option>
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
                      <button type="button" class={buttonClass} onclick={() => d.repositories.splice(j, 1)}>{t('app.integrations.remove', 'Remove')}</button>
                    </div>
                    {#if errors[p]}<p id="{field(p)}-error" role="alert" class={errorClass}>{errors[p]}</p>{/if}
                  </div>
                {/each}
              </div>
              {#if errors[`${at}.repositories`]}<p role="alert" class={errorClass}>{errors[`${at}.repositories`]}</p>{/if}
              <button type="button" class="{buttonClass} mt-2" disabled={d.repositories.length >= MAX_REPOSITORIES} onclick={() => d.repositories.push('')}>{t('app.integrations.add-repository', 'Add repository')}</button>
            </div>

            <div>
              <label for={field(`${at}.readyLabel`)} class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('app.integrations.ready-label', 'Ready label')}</label>
              <input id={field(`${at}.readyLabel`)} type="text" bind:value={d.readyLabel} aria-invalid={!!errors[`${at}.readyLabel`]} aria-describedby={describedBy(`${at}.readyLabel`)} class="{inputClass} {errors[`${at}.readyLabel`] ? 'border-red-500' : ''}" />
              {#if errors[`${at}.readyLabel`]}<p id="{field(`${at}.readyLabel`)}-error" role="alert" class={errorClass}>{errors[`${at}.readyLabel`]}</p>{/if}
            </div>

            <div>
              <span class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300" id={field(`${at}.excludeLabels`)}>{t('app.integrations.excluded-labels', 'Excluded labels')}</span>
              <div role="group" aria-labelledby={field(`${at}.excludeLabels`)} class="space-y-2">
                {#each d.excludeLabels as _, j (j)}
                  {@const p = `${at}.excludeLabels[${j}]`}
                  <div>
                    <div class="flex gap-2">
                      <input id={field(p)} type="text" bind:value={d.excludeLabels[j]} aria-label={t('app.integrations.excluded-label-n', 'Excluded label {n}', { n: j + 1 })} aria-invalid={!!errors[p]} aria-describedby={describedBy(p)} class="{inputClass} {errors[p] ? 'border-red-500' : ''}" />
                      <button type="button" class={buttonClass} onclick={() => d.excludeLabels.splice(j, 1)}>{t('app.integrations.remove', 'Remove')}</button>
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
                  {@const s = leadStatus(team.lead, roster)}
                  <div class="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800" data-team={j}>
                    <label for={field(lp)} class="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">{t('app.integrations.lead', 'Lead')}</label>
                    <select id={field(lp)} value={team.lead ?? ''} onchange={(e) => pickLead(i, j, e.currentTarget.value)} aria-invalid={!!errors[lp]} aria-describedby={describedBy(lp)} class="{inputClass} {errors[lp] ? 'border-red-500' : ''}">
                      {#if s.kind === 'unknown'}
                        <option value="">{t('app.integrations.lead.unknown', 'Unknown worker')}</option>
                      {:else if s.kind === 'retired'}
                        <option value={s.urn}>{s.name ?? s.urn} ({t('app.integrations.lead.retired', 'No longer a live worker')})</option>
                      {/if}
                      {#each liveWorkers as w (w.id)}
                        <option value={w.urn ?? w.id}>{w.name}</option>
                      {/each}
                    </select>
                    {#if s.kind !== 'unknown'}
                      <div class="mt-1 text-xs">
                        {#if s.name}<Urn value={s.urn} size={10} compact />{/if}
                        {#if s.kind === 'retired'}<p class="text-amber-700 dark:text-amber-400">{t('app.integrations.lead.retired', 'No longer a live worker')}</p>{/if}
                      </div>
                    {/if}
                    {#if errors[lp]}<p id="{field(lp)}-error" role="alert" class={errorClass}>{errors[lp]}</p>{/if}

                    <label for={field(tp)} class="mt-3 mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">{t('app.integrations.team-label', 'Label')}</label>
                    <div class="flex gap-2">
                      <input id={field(tp)} type="text" bind:value={team.label} aria-invalid={!!errors[tp]} aria-describedby={describedBy(tp)} class="{inputClass} {errors[tp] ? 'border-red-500' : ''}" />
                      <button type="button" class={buttonClass} onclick={() => d.teams.splice(j, 1)}>{t('app.integrations.remove-team', 'Remove team')}</button>
                    </div>
                    {#if errors[tp]}<p id="{field(tp)}-error" role="alert" class={errorClass}>{errors[tp]}</p>{/if}
                  </div>
                {/each}
              </div>
              <button type="button" class="{buttonClass} mt-2" disabled={liveWorkers.length === 0} onclick={() => d.teams.push({ lead: liveWorkers[0] ? (liveWorkers[0].urn ?? liveWorkers[0].id) : null, label: '' })}>{t('app.integrations.add-team', 'Add team')}</button>
            </div>

            <div class="flex justify-end">
              <button type="button" class={buttonClass} onclick={() => drafts.splice(i, 1)}>{t('app.integrations.remove-integration', 'Remove integration')}</button>
            </div>
          </fieldset>
        {/each}

        <div class="flex items-center gap-2">
          <button type="button" class={buttonClass} onclick={() => drafts.push(blank())}>{t('app.integrations.add', 'Add integration')}</button>
          <span class="flex-1"></span>
          <button type="button" class={buttonClass} onclick={cancel}>{t('app.integrations.cancel', 'Cancel')}</button>
          <button type="submit" disabled={pending} class="rounded-md bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50">{t('app.integrations.save', 'Save')}</button>
        </div>
      </form>
    {/if}
  </section>
{/if}
