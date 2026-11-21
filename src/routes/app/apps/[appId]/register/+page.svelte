<script lang="ts">
  import { goto } from '$app/navigation';
  import { page as appPage } from '$app/state';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import SelectAgent from '$lib/components/SelectAgent.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import ActionRegisterList from '$lib/components/action-register/ActionRegisterList.svelte';
  import { parseLimit, parseOffset } from '$lib/action-register/present';
  import { t } from '$lib/i18n/t';
  import type { PageData } from './$types';

  /**
   * The user wants to know which code sends work to which task in this App.
   * Reuse: SelectAgent, DataTable (via ActionRegisterList), Urn. Nothing is
   * built new except the list. Outline: heading → asking Agent (name, URN,
   * Change…) → table → paging.
   */
  let { data }: { data: PageData } = $props();

  const basePath = $derived(`/app/apps/${data.app.id}`);
  const appsHref = $derived(data.app.organizationId ? `/app/orgs/${data.app.organizationId}/apps` : '/app/apps');
  let pickerOpen = $state(false);

  // A late answer for another App, Agent, limit or page is not drawn under the
  // controls of this one: every term comes from the URL, none from the answer
  // (the App is the route's own param, as the loader keyed it).
  const current = $derived(
    `${appPage.params.appId ?? ''}|${appPage.url.searchParams.get('agent')?.trim() ?? ''}|${parseLimit(appPage.url.searchParams.get('limit'))}|${parseOffset(appPage.url.searchParams.get('offset'))}`,
  );
  const stale = $derived(data.key !== current);

  function hrefFor(offset: number): string {
    const u = new URLSearchParams();
    if (data.agentRef) u.set('agent', data.agentRef);
    if (data.limit !== 20) u.set('limit', String(data.limit));
    if (offset > 0) u.set('offset', String(offset));
    const q = u.toString();
    return `${basePath}/register${q ? `?${q}` : ''}`;
  }
  // Changing the Agent starts over at the first page.
  function choose(agent: { id: string }) {
    const u = new URLSearchParams({ agent: agent.id });
    if (data.limit !== 20) u.set('limit', String(data.limit));
    void goto(`${basePath}/register?${u}`, { keepFocus: true });
  }
</script>

<svelte:head><title>{t('action-register.head', 'Action register')} · {data.app.name} · Hadron</title></svelte:head>

<div class="space-y-4">
  <Breadcrumb items={[
    { label: t('action-register.crumb.apps', 'Apps'), href: appsHref },
    { label: data.app.name, href: basePath },
    { label: t('action-register.crumb.register', 'Action register') },
  ]} />

  <div>
    <h1 class="text-xl font-bold text-zinc-900 dark:text-white">
      <span class="font-normal text-zinc-400">{t('action-register.title.prefix', 'Action register:')}</span> {data.app.name}
    </h1>
    <p class="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
      {t('action-register.intro', 'Each code sends work to a role task. Choose the Agent whose tasks the codes should resolve against.')}
    </p>
  </div>

  <section aria-label={t('action-register.agent.heading', 'Agent')} class="space-y-2">
    {#if data.options.kind === 'failed'}
      <div role="alert" class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
        {t('action-register.options-failed', 'Couldn’t load this App’s Agents.')}
      </div>
    {:else if data.options.agents.length === 0 && !data.chosen}
      <p role="status" class="text-sm text-zinc-600 dark:text-zinc-400">{t('action-register.no-agents', 'This App has no Agents to choose from.')}</p>
    {:else}
      {#if data.chosen}
        <div>
          <p class="text-sm font-medium text-zinc-900 dark:text-white" data-testid="register-agent-name">{data.chosen.name}</p>
          {#if data.chosen.urn}<div class="mt-1"><Urn value={data.chosen.urn} type="agent" linked label={t('action-register.agent', 'Agent')} /></div>{/if}
        </div>
      {:else}
        <p class="text-sm text-zinc-500 dark:text-zinc-400">{t('action-register.choose-prompt', 'Choose an Agent to see its codes.')}</p>
      {/if}
      <button type="button" onclick={() => (pickerOpen = true)} aria-haspopup="dialog" aria-expanded={pickerOpen} class="min-h-6 rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
        {data.chosen ? t('action-register.change', 'Change…') : t('action-register.choose', 'Choose…')}
      </button>
      {#if data.options.partial}
        <p class="text-xs text-zinc-500 dark:text-zinc-400">{t('action-register.options-partial', 'This list may be incomplete.')}</p>
      {/if}
      <SelectAgent agents={data.options.agents} bind:open={pickerOpen} onselect={choose} />
    {/if}
  </section>

  {#if data.index === null}
    <!-- No Agent chosen: nothing was asked, so nothing is empty. -->
  {:else if stale}
    <p role="status" class="text-sm text-zinc-500">{t('action-register.loading', 'Loading…')}</p>
  {:else if data.index.kind === 'agent-not-found'}
    <div role="alert" class="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200" data-testid="register-agent-refused">
      {t('action-register.agent-refused', 'This Agent can’t be used for this App.')}
    </div>
  {:else if data.index.kind === 'failed'}
    <div role="alert" class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300" data-testid="register-failed">
      {t('action-register.load-failed', 'Couldn’t load the action register.')}
    </div>
  {:else if data.index.kind === 'ok'}
    <ActionRegisterList page={data.index.page} offset={data.offset} limit={data.limit} {hrefFor} listKey="app-action-register" nextStep={t('action-register.empty.next-agent', 'Choose a different Agent to see its codes.')} />
  {/if}
</div>
