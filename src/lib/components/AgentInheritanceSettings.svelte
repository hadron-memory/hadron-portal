<script lang="ts">
  import type { Infer, SuperValidated } from 'sveltekit-superforms';
  import type { agentBaseSchema, agentIndexRefsSchema } from '../../routes/app/agents/[id]/inheritance-schema';
  import type { InheritanceManagement } from '$lib/server/agent-inheritance-write';
  import { submittedForm, failedSubmission } from '$lib/forms/submitted-form';
  import { scopedActionError, scopedActionSuccess } from '$lib/forms/scoped-message';
  import { t } from '$lib/i18n/t';
  import type { AgentBaseRead } from '$lib/agent-inheritance';
  import Urn from './Urn.svelte';
  type Base = Infer<typeof agentBaseSchema>;
  type Indexes = Infer<typeof agentIndexRefsSchema>;
  let { management, currentBase, baseForm, indexRefsForm, actionData }: {
    management: InheritanceManagement;
    currentBase?: AgentBaseRead;
    baseForm: SuperValidated<Base>;
    indexRefsForm: SuperValidated<Indexes>;
    actionData: unknown;
  } = $props();
  const base = $derived(failedSubmission<Base>(actionData, 'setAgentBase') ?? baseForm);
  const indexes = $derived(failedSubmission<Indexes>(actionData, 'setAgentIndexRefs') ?? indexRefsForm);
  const baseError = $derived(scopedActionError<Base>(actionData, 'setAgentBase', base.message, base.errors, ['operation', 'baseRef', '_kind']));
  const baseSuccess = $derived(scopedActionSuccess<Base>(actionData, 'setAgentBase', submittedForm<Base>(actionData, 'setAgentBase')?.message));
  const indexError = $derived(scopedActionError<Indexes>(actionData, 'setAgentIndexRefs', indexes.message, indexes.errors, ['tasksOperation', 'tasksIndexRef', 'processesOperation', 'processesIndexRef', '_kind']));
  const indexSuccess = $derived(scopedActionSuccess<Indexes>(actionData, 'setAgentIndexRefs', submittedForm<Indexes>(actionData, 'setAgentIndexRefs')?.message));
  const inputClass = 'w-full min-w-0 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900';
  const buttonClass = 'rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500';
</script>
{#snippet baseFeedback()}
  {#if baseError}<p id="agent-base-error" role="alert" class="break-words text-sm text-red-600 dark:text-red-400">{baseError}</p>{/if}
  {#if baseSuccess}<p role="status" class="text-sm text-green-700 dark:text-green-400">{baseSuccess}</p>{/if}
{/snippet}
{#snippet indexFeedback()}
  {#if indexError}<p id="agent-index-error" role="alert" class="break-words text-sm text-red-600 dark:text-red-400">{indexError}</p>{/if}
  {#if indexSuccess}<p role="status" class="text-sm text-green-700 dark:text-green-400">{indexSuccess}</p>{/if}
{/snippet}
{#if management.error || !management.canManage || !management.refs}
  {@render baseFeedback()}
  {@render indexFeedback()}
{/if}
{#if management.error}
  <p role="alert" class="break-words text-sm text-red-600 dark:text-red-400">{management.error}</p>
{:else if management.canManage && management.refs}
  <section class="max-w-lg space-y-6 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800" aria-labelledby="inheritance-settings-title">
    <h2 id="inheritance-settings-title" class="text-lg font-semibold">{t('agent.inheritance.settings', 'Agent inheritance')}</h2>
    <!-- Native POST forms keep the server-returned discriminator, values and
         errors together; no client form store outlives an Agent navigation. -->
    <form method="POST" action="?/setBase" novalidate class="space-y-3">
      <input type="hidden" name="_kind" value="setAgentBase" />
      <h3 class="font-medium">{t('agent.base.heading', 'Base Agent')}</h3>
      {#if currentBase?.agent}
        <span class="block break-words text-sm">{currentBase.agent.name}</span>
        <Urn value={currentBase.agent.urn} label={t('agent.base.label', 'base Agent')} linked />
      {:else if currentBase?.error}
        <p role="alert" class="break-words text-sm text-red-600">{currentBase.error}</p>
      {:else if currentBase?.id}
        <p class="text-sm text-zinc-500">{t('agent.base.unavailable', 'Base Agent details are unavailable.')}</p>
      {:else}
        <p class="text-sm text-zinc-500">{t('agent.inheritance.none', 'None')}</p>
      {/if}
      <p class="text-sm text-zinc-500">{t('agent.inheritance.clear-help', 'Clearing the base removes inherited tasks and processes from this Agent. Its own definitions stay unchanged.')}</p>
      <label class="block space-y-1"><span class="text-sm">{t('agent.inheritance.base-operation', 'Base change')}</span>
        <select name="operation" value={base.data.operation} class={inputClass}>
          <option value="set">{t('agent.inheritance.base-set', 'Set or change base')}</option>
          <option value="clear">{t('agent.inheritance.base-clear', 'Clear base')}</option>
        </select>
      </label>
      <label class="block space-y-1"><span class="text-sm">{t('agent.inheritance.base-ref', 'Base Agent reference (used when setting)')}</span>
        <input name="baseRef" value={base.data.baseRef} placeholder="hrn:agent:example.com:base" class={inputClass} aria-invalid={!!base.errors.baseRef} aria-describedby={baseError ? 'agent-base-error' : undefined} />
      </label>
      {@render baseFeedback()}
      <button type="submit" class={buttonClass}>{t('agent.inheritance.save-base', 'Save base')}</button>
    </form>
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
