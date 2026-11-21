<script lang="ts">
  import LiveRegion from '$lib/components/LiveRegion.svelte';
  // portal#1538 (hadron-server#2458 S4; hrn:node:hadronmemory.com:specs:cor:dmo:050:11) — change the Agent (and so
  // the role) a cast worker runs. Offered by the page only to a manager acting as
  // themselves; the server stays the authority and refuses anyone else.
  import { enhance } from '$app/forms';
  import SelectAgent from '$lib/components/SelectAgent.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import { t } from '$lib/i18n/t';
  import type { ChangeAgentResult } from '$lib/workers/change-agent';

  interface Option { id: string; name: string; urn: string; description?: string | null }

  let { options, result, action = '?/changeWorkerAgent' }: { options: Option[] | null; result: ChangeAgentResult | null; action?: string } = $props();

  let pickerOpen = $state(false);
  let pick = $state<Option | null>(null);
  let submitting = $state(false);

  const submit = () => {
    submitting = true;
    return async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => {
      await update({ reset: false });
      submitting = false;
      pick = null;
    };
  };
</script>

<section class="max-w-lg space-y-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800" aria-labelledby="worker-change-agent-title" data-testid="change-agent">
  <h2 id="worker-change-agent-title" class="font-semibold text-zinc-900 dark:text-white">{t('worker.change-agent.title', 'Change agent')}</h2>

  <div class="space-y-1 text-sm text-zinc-600 dark:text-zinc-400">
    <p>{t('worker.change-agent.changes', 'The role follows the new agent, and this worker is served the new role’s boot prompt. A worker with its own compiled prompt loses it until someone compiles a new one. The old agent’s generated tickers end and the new agent’s are made.')}</p>
    <p>{t('worker.change-agent.when', 'It takes effect at the worker’s next bind. An open session finishes as the agent and role it started with.')}</p>
    <p>{t('worker.change-agent.stays', 'Its name, slug, URN, signature, trailer, reporting line and past records stay as they are. Past sessions keep the agent and role they ran under.')}</p>
  </div>

  <!-- The outcome outlives the roster: a refresh that empties or fails the option list must not hide it. -->
  {#if result?.refusal}
    <div role="alert" class="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300" data-testid="change-agent-refusal">
      {result.refusal.message}
    </div>
  {/if}
  <LiveRegion>
    {#if !result?.refusal && result?.ok}
      <p class="text-sm text-green-700 dark:text-green-300" data-testid="change-agent-done">
        {t('worker.change-agent.done', 'Agent changed to {agent}. It takes effect at this worker’s next bind.', { agent: result.agentName })}
      </p>
    {/if}
  </LiveRegion>

  {#if options === null}
    <p class="text-sm text-zinc-500" data-testid="change-agent-unavailable">{t('worker.change-agent.unavailable', 'We couldn’t load the agents installed in this App. Reload the page to try again.')}</p>
  {:else if options.length === 0}
    <p class="text-sm text-zinc-500" data-testid="change-agent-none">{t('worker.change-agent.none', 'No other agent with a role is installed in this App. Install one first.')}</p>
  {:else}
    <form method="POST" {action} use:enhance={submit} class="space-y-3">
      <input type="hidden" name="agentId" value={pick?.id ?? ''} />
      {#if pick}
        <div class="text-sm">
          <span class="font-medium text-zinc-900 dark:text-white">{pick.name}</span>
          <div class="mt-1"><Urn value={pick.urn} type="agent" size={8} /></div>
        </div>
      {/if}
      <div class="flex flex-wrap items-center gap-2">
        <button type="button" onclick={() => (pickerOpen = true)} aria-haspopup="dialog" aria-expanded={pickerOpen} class="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
          {pick ? t('worker.change-agent.choose-other', 'Choose another') : t('worker.change-agent.choose', 'Choose agent')}
        </button>
        <button type="submit" disabled={!pick || submitting} class="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50">
          {t('worker.change-agent.submit', 'Change agent')}
        </button>
        {#if pick}
          <button type="button" onclick={() => (pick = null)} class="rounded-md px-3 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800">
            {t('worker.change-agent.cancel', 'Cancel')}
          </button>
        {/if}
      </div>
    </form>
    <SelectAgent agents={options} bind:open={pickerOpen} onselect={(agent) => (pick = agent)} />
  {/if}
</section>
