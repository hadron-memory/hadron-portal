<script lang="ts">
  import { goto } from '$app/navigation';
  import LiveRegion from '$lib/components/LiveRegion.svelte';
  import SelectAgent from '$lib/components/SelectAgent.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import ActionRegisterList from '$lib/components/action-register/ActionRegisterList.svelte';
  import { t } from '$lib/i18n/t';
  import type { loadRegisterPanel } from './register-panel';

  /**
   * portal#1649 — which code sends work to which role task in this App, as the body of a Settings section.
   * Reuse: SelectAgent, DataTable (via ActionRegisterList), Urn. Outline: asking Agent (name, URN, Change…) → table → paging.
   * The asking Agent and the page are the page URL's (`registerAgent`, `registerLimit`, `registerOffset`): a choice or a
   * page is a navigation to that URL, and the panel comes back from the page load. Everything drawn here, controls
   * included, is derived from the one panel on screen, so an answer is never drawn under another answer's controls.
   */
  type Panel = NonNullable<Awaited<ReturnType<typeof loadRegisterPanel>>>;
  let { appId, panel }: { appId: string; panel: Panel } = $props();

  const basePath = $derived(`/app/apps/${appId}`);
  let pickerOpen = $state(false);
  let navigating = $state(false);

  function hrefFor(offset: number, agent: string = panel.agentRef): string {
    const u = new URLSearchParams({ tab: 'settings', section: 'register' });
    if (agent) u.set('registerAgent', agent);
    if (panel.limit !== 20) u.set('registerLimit', String(panel.limit));
    if (offset > 0) u.set('registerOffset', String(offset));
    return `${basePath}?${u}`;
  }
  // Changing the Agent starts over at the first page.
  async function choose(agent: { id: string }) {
    navigating = true;
    try {
      await goto(hrefFor(0, agent.id), { keepFocus: true });
    } finally {
      navigating = false;
    }
  }
</script>

<div class="space-y-4">
  <p class="text-sm text-zinc-600 dark:text-zinc-400">
    {t('action-register.intro', 'Each code sends work to a role task. Choose the Agent whose tasks the codes should resolve against.')}
  </p>

  <section aria-label={t('action-register.agent.heading', 'Agent')} class="space-y-2">
    {#if panel.options.kind === 'failed'}
      <div role="alert" class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
        {t('action-register.options-failed', 'Couldn’t load this App’s Agents.')}
      </div>
    {:else if panel.options.agents.length === 0 && !panel.chosen}
      <p class="text-sm text-zinc-600 dark:text-zinc-400">{t('action-register.no-agents', 'This App has no Agents to choose from.')}</p>
    {:else}
      {#if panel.chosen}
        <div>
          <p class="text-sm font-medium text-zinc-900 dark:text-white" data-testid="register-agent-name">{panel.chosen.name}</p>
          {#if panel.chosen.urn}<div class="mt-1"><Urn value={panel.chosen.urn} type="agent" linked label={t('action-register.agent', 'Agent')} /></div>{/if}
        </div>
      {:else}
        <p class="text-sm text-zinc-500 dark:text-zinc-400">{t('action-register.choose-prompt', 'Choose an Agent to see its codes.')}</p>
      {/if}
      <button type="button" onclick={() => (pickerOpen = true)} aria-haspopup="dialog" aria-expanded={pickerOpen} class="min-h-6 rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
        {panel.chosen ? t('action-register.change', 'Change…') : t('action-register.choose', 'Choose…')}
      </button>
      {#if panel.options.partial}
        <p class="text-xs text-zinc-500 dark:text-zinc-400">{t('action-register.options-partial', 'This list may be incomplete.')}</p>
      {/if}
      <SelectAgent agents={panel.options.agents} bind:open={pickerOpen} onselect={choose} />
    {/if}
  </section>

  <LiveRegion>{#if navigating}<p class="text-sm text-zinc-500">{t('action-register.loading', 'Loading…')}</p>{/if}</LiveRegion>
  {#if panel.index === null}
    <!-- No Agent chosen: nothing was asked, so nothing is empty. -->
  {:else if panel.index.kind === 'agent-not-found'}
    <div role="alert" class="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200" data-testid="register-agent-refused">
      {t('action-register.agent-refused', 'This Agent can’t be used for this App.')}
    </div>
  {:else if panel.index.kind === 'failed'}
    <div role="alert" class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300" data-testid="register-failed">
      {t('action-register.load-failed', 'Couldn’t load the action register.')}
    </div>
  {:else if panel.index.kind === 'ok'}
    <ActionRegisterList page={panel.index.page} offset={panel.offset} limit={panel.limit} {hrefFor} listKey="app-action-register" nextStep={t('action-register.empty.next-agent', 'Choose a different Agent to see its codes.')} />
  {/if}
</div>
