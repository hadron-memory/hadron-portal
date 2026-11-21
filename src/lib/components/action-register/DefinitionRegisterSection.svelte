<script lang="ts">
  import { goto } from '$app/navigation';
  import { page as appPage } from '$app/state';
  import SelectApp from '$lib/components/SelectApp.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import LiveRegion from '$lib/components/LiveRegion.svelte';
  import ActionRegisterList from './ActionRegisterList.svelte';
  import type { DefinitionRegister } from '$lib/action-register/definition';
  import { parseLimit, parseOffset } from '$lib/action-register/present';
  import { t } from '$lib/i18n/t';

  /**
   * The user wants to know which codes send work to this task. A section on the
   * Agent definition route (portal#1649). The asking Agent is the route's own
   * Agent: this is resolution for the displayed context, not a claim that it
   * owns an inherited node. Its failures stay in this section; the definition
   * above is valid regardless.
   */
  let { register, agent, basePath }: {
    register: DefinitionRegister;
    agent: { id: string; name: string; urn: string };
    basePath: string;
  } = $props();

  let pickerOpen = $state(false);

  const ready = $derived(register.kind === 'ready' ? register : null);

  // A late answer for another App or page is not drawn under the controls of
  // this one: the loader's key (App as asked | limit | offset) must be the URL's.
  const current = $derived(
    `${appPage.url.searchParams.get('app')?.trim() ?? ''}|${parseLimit(appPage.url.searchParams.get('limit'))}|${parseOffset(appPage.url.searchParams.get('offset'))}`,
  );
  const stale = $derived(ready !== null && ready.key !== current);

  function qs(over: Record<string, string | null>): string {
    const u = new URLSearchParams();
    const app = 'app' in over ? over.app : (ready?.appId ?? null);
    if (app) u.set('app', app);
    const limit = ready && ready.limit !== 20 ? String(ready.limit) : null;
    if (limit) u.set('limit', limit);
    const offset = 'offset' in over ? over.offset : ready && ready.offset > 0 ? String(ready.offset) : null;
    if (offset) u.set('offset', offset);
    const q = u.toString();
    return `${basePath}${q ? `?${q}` : ''}`;
  }
  const hrefFor = (offset: number) => qs({ offset: offset > 0 ? String(offset) : null });
  // Changing the App starts over at the first page.
  const choose = (app: { id: string }) => void goto(qs({ app: app.id, offset: null }), { keepFocus: true });
</script>

<section aria-labelledby="register-heading" class="space-y-3 border-t border-zinc-200 pt-4 dark:border-zinc-800" data-testid="definition-register">
  <h2 id="register-heading" class="text-lg font-semibold">{t('action-register.section.title', 'Codes that send work to this task')}</h2>

  <LiveRegion>
    {#if register.kind === 'unavailable'}
      <p class="text-sm text-zinc-600 dark:text-zinc-400" data-testid="register-unavailable">
        {t('action-register.section.unavailable', 'The action register isn’t available for this Agent.')}
      </p>
    {/if}
  </LiveRegion>
  {#if register.kind === 'unavailable'}
    <!-- announced by the status region above -->
  {:else if register.kind === 'options-failed'}
    <p role="alert" class="text-sm text-red-700 dark:text-red-300">{t('action-register.section.options-failed', 'Couldn’t load the Apps for this Agent.')}</p>
  {:else}
    <div>
      {#if register.app}
        <p class="text-sm font-medium text-zinc-900 dark:text-white" data-testid="register-app-name">{register.app.name}</p>
        <div class="mt-1"><Urn value={register.app.urn} type="app" linked label={t('action-register.app', 'App')} /></div>
      {:else}
        <p class="text-sm text-zinc-500 dark:text-zinc-400">{t('action-register.section.choose-app', 'Choose an App to see its codes.')}</p>
      {/if}
      <p class="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{t('action-register.section.asking', 'Resolved as {agent}.', { agent: agent.name })}</p>
      {#if register.apps.length > 1}
        <button type="button" onclick={() => (pickerOpen = true)} aria-haspopup="dialog" aria-expanded={pickerOpen} class="mt-2 min-h-6 rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
          {register.app ? t('action-register.change', 'Change…') : t('action-register.choose', 'Choose…')}
        </button>
        <SelectApp apps={register.apps} scopeKey="action-register-definition" bind:open={pickerOpen} onselect={choose} />
      {/if}
    </div>

    <LiveRegion>
      {#if register.index && !stale && (register.index.kind === 'agent-not-found' || register.index.kind === 'app-not-found')}
        <p class="text-sm text-zinc-600 dark:text-zinc-400" data-testid="register-not-available">{t('action-register.section.not-available', 'Not available for this App.')}</p>
      {/if}
    </LiveRegion>
    {#if register.index === null}
      <!-- No App chosen: nothing was asked, so nothing is empty. -->
    {:else if stale}
      <p role="status" class="text-sm text-zinc-500">{t('action-register.loading', 'Loading…')}</p>
    {:else if register.index.kind === 'agent-not-found' || register.index.kind === 'app-not-found'}
      <!-- announced by the status region above -->
    {:else if register.index.kind === 'failed'}
      <p role="alert" class="text-sm text-red-700 dark:text-red-300" data-testid="register-failed">{t('action-register.load-failed', 'Couldn’t load the action register.')}</p>
    {:else}
      <ActionRegisterList page={register.index.page} offset={register.offset} limit={register.limit} definitionUrn={register.definitionUrn} {hrefFor} listKey="definition-action-register" nextStep={t('action-register.empty.next-app', 'Choose a different App to see its codes.')} />
    {/if}
  {/if}
</section>
