<script lang="ts">
  import { untrack } from 'svelte';
  import { superForm, type Infer, type SuperValidated } from 'sveltekit-superforms';
  import { zod4Client } from 'sveltekit-superforms/adapters';
  import AppRunsTable from '$lib/components/AppRunsTable.svelte';
  import type { RunsSection } from '$lib/flow/app-runs-page';
  import type { FlowSummary } from '$lib/flow/flows';
  import type { InstalledAgent } from '$lib/app-installed-agents';
  import Urn from '$lib/components/Urn.svelte';
  import { scopedActionError } from '$lib/forms/scoped-message';
  import { submittedForm } from '$lib/forms/submitted-form';
  import { t } from '$lib/i18n/t';
  import ListPageNav from '$lib/components/ListPageNav.svelte';
  import type { ListPageNavigation } from '$lib/list-page';
  
  import { runAppFlowSchema } from './schema';

  type RunAppFlowForm = Infer<typeof runAppFlowSchema, 'zod4'>;
  type RunAppFlowSuperform = SuperValidated<RunAppFlowForm, App.Superforms.Message, RunAppFlowForm>;

  type PanelData = RunsSection & { app: { id: string; name: string; organizationId: string | null }; flows: FlowSummary[]; flowsPage: ListPageNavigation; runForm: RunAppFlowSuperform; runAgents: InstalledAgent[] | null };
  let { data, form }: { data: PanelData; form: unknown } = $props();

  const initialRunForm = untrack(() => submittedForm<RunAppFlowForm>(form, 'runFlow') as RunAppFlowSuperform | null ?? data.runForm);
  const {
    form: runFormData,
    errors: runErrors,
    message: runMessage,
    submitting: runSubmitting,
    enhance: runEnhance,
  } = superForm<RunAppFlowForm, App.Superforms.Message, RunAppFlowForm>(initialRunForm, {
    validators: zod4Client(runAppFlowSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
  });
  // The page is reused across param-only navigation, so the form store outlives
  // the App: an Agent chosen for App A must not ride along into App B (#1444).
  let seenAppId = untrack(() => data.app.id);
  $effect(() => {
    const id = data.app.id;
    if (id === seenAppId) return;
    seenAppId = id;
    runFormData.update((current) => ({ ...current, agentRef: '' }), { taint: false });
  });
  const runActionError = $derived(scopedActionError<RunAppFlowForm>(form, 'runFlow', $runMessage, $runErrors, ['entryUrn', 'agentRef', '_kind']));

  function prepareRun(entryUrn: string) {
    runFormData.update((current) => ({ ...current, entryUrn }), { taint: false });
  }
</script>

<div class="min-w-0 space-y-4">
  <!-- Flows this app can start (#483) — derived: runnable entry nodes with
       routing edges. The Run button mints a MANUAL run; payloads live on the
       node page's Test-flow panel. -->
  {#if data.flows.length > 0 || data.flowsPage.count > 0}
    <section class="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 class="text-sm font-semibold text-zinc-900 dark:text-white">{t('flows.title', 'Flows')}</h2>
      <p class="mt-1 text-xs text-zinc-400">
        {t('flows.explainer', 'Runnable entry nodes with routing edges in this app’s memories. Run one here, or open the node to run it with a test payload.')}
      </p>
      <!-- An App with several installed Agents refuses a run that names none
           (hadron-server#2849); with one or none there is nothing to choose. -->
      {#if data.runAgents}
        <div class="mt-3 max-w-xs">
          <label for="runAgent" class="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300">{t('flows.agent', 'Run as Agent')}</label>
          <select
            id="runAgent"
            bind:value={$runFormData.agentRef}
            class="w-full min-w-0 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
          >
            <option value="" disabled>{t('flows.agent-pick', 'Choose an Agent…')}</option>
            {#each data.runAgents as agent (agent.id)}
              <option value={agent.id}>{agent.name}</option>
            {/each}
          </select>
        </div>
      {/if}
      {#if runActionError}
        <div role="alert" class="mt-3 rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{runActionError}</div>
      {/if}
      {#if data.flows.length > 0}
        <ul class="mt-3 divide-y divide-zinc-100 dark:divide-zinc-800">
        {#each data.flows as flow (flow.entry.id)}
          <li class="flex flex-wrap items-center gap-x-4 gap-y-2 py-2.5">
            <div class="min-w-0 flex-1">
              <a
                href="/app/memories/{flow.entry.memoryId}/nodes/{flow.entry.id}"
                class="font-medium text-indigo-600 hover:underline dark:text-indigo-300"
              >{flow.entry.name}</a>
              <div class="mt-0.5"><Urn value={flow.entry.urn} type="node" size={10} /></div>
            </div>
            <span class="text-xs text-zinc-500 dark:text-zinc-400">
              {flow.stepCount} {t('flows.steps', 'steps')}{#if flow.branchCount > 1} · {flow.branchCount} {t('flows.branches', 'branches')}{/if}
            </span>
            <!-- Click updates before Superforms client validation; submit covers keyboard/requestSubmit paths. -->
            <form method="POST" action="?tab=runs&/run" use:runEnhance onsubmit={() => prepareRun(flow.entry.urn)} novalidate>
              <input type="hidden" name="_kind" value={$runFormData._kind} />
              <input type="hidden" name="entryUrn" value={flow.entry.urn} />
              <input type="hidden" name="agentRef" value={$runFormData.agentRef} />
              <button
                type="submit"
                disabled={$runSubmitting}
                onclick={() => prepareRun(flow.entry.urn)}
                class="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
              >▶ {t('flows.run', 'Run')}</button>
            </form>
          </li>
        {/each}
        </ul>
      {:else}
        <p class="mt-3 text-sm text-zinc-500 dark:text-zinc-400">{t('flows.none-on-page', 'No flows on this page.')}</p>
      {/if}
      <ListPageNav page={data.flowsPage} label={t('flows.pages', 'Flow pages')} />
    </section>
  {/if}

  {#if !data.failed && data.total === 0 && data.statuses.length === 0}
    <p class="text-sm text-zinc-500">{data.flows.length ? t('runs.empty.explainer.flows', 'Runs start from a trigger: a schedule (run every morning), a webhook (run when an outside system calls), or manually — hit Run on a flow above to mint one.') : t('runs.empty.explainer', 'Runs start from a trigger: a schedule (run every morning), a webhook (run when an outside system calls), or manually — the “Test flow” button on any runnable node mints one.')}</p>
  {/if}
  <AppRunsTable appRef={data.app.id} initial={data} />
</div>
