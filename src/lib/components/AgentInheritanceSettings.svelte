<script lang="ts">
  import LiveRegion from '$lib/components/LiveRegion.svelte';
  import type { Infer, SuperValidated } from 'sveltekit-superforms';
  import type { agentBaseSchema, agentIndexRefsSchema } from '../../routes/app/agents/[id]/inheritance-schema';
  import type { InheritanceManagement } from '$lib/server/agent-inheritance-write';
  import { submittedForm, failedSubmission } from '$lib/forms/submitted-form';
  import { scopedActionError, scopedActionSuccess } from '$lib/forms/scoped-message';
  import { t } from '$lib/i18n/t';
  import type { AgentBaseRead } from '$lib/agent-inheritance';
  import type { BaseCandidate } from '$lib/server/agent-inheritance-write';
  import SelectAgent from './SelectAgent.svelte';
  import Urn from './Urn.svelte';
  type Base = Infer<typeof agentBaseSchema>;
  type Indexes = Infer<typeof agentIndexRefsSchema>;
  let { management, currentBase, baseForm, indexRefsForm, candidates, actionData }: {
    management: InheritanceManagement;
    currentBase?: AgentBaseRead;
    baseForm: SuperValidated<Base>;
    indexRefsForm: SuperValidated<Indexes>;
    candidates: BaseCandidate[] | null;
    actionData: unknown;
  } = $props();
  const base = $derived(failedSubmission<Base>(actionData, 'setAgentBase') ?? baseForm);
  const indexes = $derived(failedSubmission<Indexes>(actionData, 'setAgentIndexRefs') ?? indexRefsForm);
  const baseError = $derived(scopedActionError<Base>(actionData, 'setAgentBase', base.message, base.errors, ['operation', 'baseRef', '_kind']));
  const baseSuccess = $derived(scopedActionSuccess<Base>(actionData, 'setAgentBase', submittedForm<Base>(actionData, 'setAgentBase')?.message));
  const indexError = $derived(scopedActionError<Indexes>(actionData, 'setAgentIndexRefs', indexes.message, indexes.errors, ['tasksOperation', 'tasksIndexRef', 'processesOperation', 'processesIndexRef', '_kind']));
  const indexSuccess = $derived(scopedActionSuccess<Indexes>(actionData, 'setAgentIndexRefs', submittedForm<Indexes>(actionData, 'setAgentIndexRefs')?.message));
  const inputClass = 'w-full min-w-0 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900';
  const buttonClass = 'rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50';
  const secondaryButtonClass = 'rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800';
  // #1108: the parent-agent draft. `pick` holds the SelectAgent selection; a
  // refused POST re-seeds the draft through the failed form's baseRef
  // (base.data.baseRef), so the user keeps what they chose. Both reset when the
  // page hands the component another Agent's forms (fresh baseForm object).
  // `discardSeed` (#1271 fix head) lets Discard drop a refused-POST seed too,
  // not just a fresh pick.
  let pick = $state<BaseCandidate | null>(null);
  let pickerOpen = $state(false);
  let discardSeed = $state(false);
  $effect(() => {
    void baseForm;
    pick = null;
    pickerOpen = false;
    discardSeed = false;
  });
  const draftRef = $derived(pick?.urn ?? (discardSeed ? '' : base.data.baseRef));
  const resolvedDraft = $derived(draftRef ? (candidates ?? []).find((c) => c.urn === draftRef || c.id === draftRef) ?? null : null);
  const displayAgent = $derived(pick ?? resolvedDraft ?? (draftRef ? null : currentBase?.agent ?? null));
  // #1271 fix head (Uma P2): a draft naming anything other than the current
  // base is UNSAVED and must say so, with a way back. The same comparison
  // disables a no-op Save (draft equals the saved base).
  const draftMatchesSaved = $derived(
    !!draftRef && (draftRef === currentBase?.agent?.urn || draftRef === currentBase?.agent?.id || draftRef === currentBase?.id),
  );
  const draftUnsaved = $derived(!!draftRef && !draftMatchesSaved);
</script>
{#snippet baseFeedback()}
  {#if baseError}<p id="agent-base-error" role="alert" class="break-words text-sm text-red-600 dark:text-red-400">{baseError}</p>{/if}
  <LiveRegion>
    {#if baseSuccess}<p class="text-sm text-green-700 dark:text-green-400">{baseSuccess}</p>{/if}
  </LiveRegion>
{/snippet}
{#snippet indexFeedback()}
  {#if indexError}<p id="agent-index-error" role="alert" class="break-words text-sm text-red-600 dark:text-red-400">{indexError}</p>{/if}
  <LiveRegion>
    {#if indexSuccess}<p class="text-sm text-green-700 dark:text-green-400">{indexSuccess}</p>{/if}
  </LiveRegion>
{/snippet}
{#if management.error || !management.canManage || !management.refs}
  {@render baseFeedback()}
  {@render indexFeedback()}
{/if}
{#if management.error}
  <p role="alert" class="break-words text-sm text-red-600 dark:text-red-400">{management.error}</p>
{:else if management.canManage && management.refs}
  <section class="max-w-lg space-y-6 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800" aria-labelledby="inheritance-settings-title">
    <h2 id="inheritance-settings-title" class="text-lg font-semibold">{t('agent.parent.heading', 'Parent agent')}</h2>
    <!-- Native POST forms keep the server-returned discriminator, values and
         errors together; no client form store outlives an Agent navigation.
         The set/clear intent rides the submitting button's name/value, so no
         mode dropdown and no client state can diverge from what is POSTed. -->
    <form method="POST" action="?/setBase" novalidate class="space-y-3">
      <input type="hidden" name="_kind" value="setAgentBase" />
      <div class="min-w-0">
        {#if displayAgent}
          <span class="block break-words text-sm">{displayAgent.name}</span>
          <Urn value={displayAgent.urn} label={t('agent.base.label', 'base Agent')} linked />
        {:else if draftRef}
          <!-- A draft the candidate list cannot name (e.g. a refused ref
               outside it): still show the URN once, never a bare id. -->
          <Urn value={draftRef} label={t('agent.base.label', 'base Agent')} linked />
        {:else if currentBase?.error}
          <p role="alert" class="break-words text-sm text-red-600">{currentBase.error}</p>
        {:else if currentBase?.id}
          <p class="text-sm text-zinc-500">{t('agent.base.unavailable', 'Base Agent details are unavailable.')}</p>
        {:else}
          <p class="text-sm text-zinc-500">{t('agent.inheritance.none', 'None')}</p>
        {/if}
        {#if draftUnsaved}
          {#if currentBase?.agent}
            <p role="status" class="text-sm text-amber-600 dark:text-amber-400">{t('agent.parent.unsaved-replace', 'Not saved yet — Save will replace {name} as the parent agent.', { name: currentBase.agent.name })}</p>
          {:else}
            <p role="status" class="text-sm text-amber-600 dark:text-amber-400">{t('agent.parent.unsaved-set', 'Not saved yet — Save will set {name} as the parent agent.', { name: displayAgent?.name ?? draftRef })}</p>
          {/if}
        {/if}
      </div>
      <input type="hidden" name="baseRef" value={draftRef} />
      <div class="flex flex-wrap items-center gap-3">
        <button type="button" onclick={() => (pickerOpen = true)} aria-haspopup="dialog" aria-expanded={pickerOpen} disabled={candidates === null} class={secondaryButtonClass}>{t('agent.parent.change', 'Change…')}</button>
        <button type="submit" name="operation" value="set" disabled={!draftUnsaved} class={buttonClass}>{t('agent.parent.save', 'Save')}</button>
        <button type="submit" name="operation" value="clear" disabled={!currentBase?.id && !draftRef} class={secondaryButtonClass}>{t('agent.parent.clear', 'Clear')}</button>
        <button type="button" onclick={() => { pick = null; discardSeed = true; }} disabled={!draftUnsaved} class={secondaryButtonClass}>{t('agent.parent.discard', 'Discard')}</button>
        <p class="w-full text-sm text-zinc-500 sm:w-auto sm:flex-1">{t('agent.inheritance.clear-help', 'Clearing the base removes inherited tasks and processes from this Agent. Its own definitions stay unchanged.')}</p>
      </div>
      {#if candidates === null}
        <p class="text-sm text-zinc-500">{t('agent.parent.candidates-unavailable', 'Could not load agents to choose from.')}</p>
      {/if}
      {@render baseFeedback()}
    </form>
    <SelectAgent agents={candidates ?? []} bind:open={pickerOpen} onselect={(agent) => (pick = agent)} />
    <form method="POST" action="?/setIndexRefs" novalidate class="space-y-4 border-t border-zinc-200 pt-4 dark:border-zinc-800">
      <input type="hidden" name="_kind" value="setAgentIndexRefs" />
      <h3 class="font-medium">{t('agent.inheritance.indexes', 'Index references')}</h3>
      <p class="text-sm text-zinc-500">{t('agent.inheritance.index-help', 'Keep leaves a reference unchanged. Set uses the reference you enter. Clear removes it.')}</p>
      <div class="grid gap-4 sm:grid-cols-2">
        <fieldset class="min-w-0 space-y-2">
          <legend class="mb-2 text-sm font-medium">{t('agent.inheritance.tasks-index', 'Tasks index')}</legend>
          {#if management.tasksNode}<span class="block break-words text-sm">{management.tasksNode.name}</span><Urn value={management.tasksNode.urn} label={t('agent.inheritance.tasks-index', 'Tasks index')} linked />
          {:else}<p class="break-all font-mono text-xs">{management.refs.tasksIndexRef ?? t('agent.inheritance.none', 'None')}</p>{/if}
          <label class="block space-y-1"><span class="text-sm">{t('agent.inheritance.tasks-operation', 'Tasks index change')}</span><select name="tasksOperation" value={indexes.data.tasksOperation} class={inputClass}>
            <option value="keep">{t('agent.inheritance.keep', 'Keep')}</option><option value="set">{t('agent.inheritance.set', 'Set')}</option><option value="clear">{t('agent.inheritance.clear', 'Clear')}</option>
          </select></label>
          <label class="block space-y-1"><span class="text-sm">{t('agent.inheritance.tasks-ref', 'Tasks index reference (used when setting)')}</span><input name="tasksIndexRef" value={indexes.data.tasksIndexRef} placeholder="hrn:node:example.com:system:tasks" class={inputClass} aria-invalid={!!indexes.errors.tasksIndexRef} aria-describedby={indexError ? 'agent-index-error' : undefined} /></label>
        </fieldset>
        <fieldset class="min-w-0 space-y-2">
          <legend class="mb-2 text-sm font-medium">{t('agent.inheritance.processes-index', 'Processes index')}</legend>
          {#if management.processesNode}<span class="block break-words text-sm">{management.processesNode.name}</span><Urn value={management.processesNode.urn} label={t('agent.inheritance.processes-index', 'Processes index')} linked />
          {:else}<p class="break-all font-mono text-xs">{management.refs.processesIndexRef ?? t('agent.inheritance.none', 'None')}</p>{/if}
          <label class="block space-y-1"><span class="text-sm">{t('agent.inheritance.processes-operation', 'Processes index change')}</span><select name="processesOperation" value={indexes.data.processesOperation} class={inputClass}>
            <option value="keep">{t('agent.inheritance.keep', 'Keep')}</option><option value="set">{t('agent.inheritance.set', 'Set')}</option><option value="clear">{t('agent.inheritance.clear', 'Clear')}</option>
          </select></label>
          <label class="block space-y-1"><span class="text-sm">{t('agent.inheritance.processes-ref', 'Processes index reference (used when setting)')}</span><input name="processesIndexRef" value={indexes.data.processesIndexRef} placeholder="hrn:node:example.com:system:processes" class={inputClass} aria-invalid={!!indexes.errors.processesIndexRef} aria-describedby={indexError ? 'agent-index-error' : undefined} /></label>
        </fieldset>
      </div>
      {@render indexFeedback()}
      <button type="submit" class={buttonClass}>{t('agent.inheritance.save-indexes', 'Save index references')}</button>
    </form>
  </section>
{/if}
