<script lang="ts">
  // #648 part 2: create a personal (org-less) app by installing a PUBLIC or your
  // own personal agent. Modeled on the org install form, plus an agent picker
  // (the org route gets its agent from the URL; here you choose one).
  import { untrack } from 'svelte';
  import { superForm, type Infer } from 'sveltekit-superforms';
  import { zod4Client } from 'sveltekit-superforms/adapters';
  import Urn from '$lib/components/Urn.svelte';
  import { t } from '$lib/i18n/t';
  import type { PageData, ActionData } from './$types';
  import type { InstallableAgent } from './+page.server';
  import { createPersonalAppSchema } from './schema';

  type CreatePersonalAppForm = Infer<typeof createPersonalAppSchema, 'zod4'>;

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const agents = $derived(data.agents ?? []);
  const handle = $derived(data.handle);

  function agentSlugFromUrn(urn: string): string {
    const colon = urn.lastIndexOf(':');
    return colon >= 0 ? urn.slice(colon + 1) : urn;
  }

  const {
    form: appForm,
    errors,
    constraints,
    message: formMessage,
    submitting,
    enhance,
  } = superForm<CreatePersonalAppForm, App.Superforms.Message, CreatePersonalAppForm>(untrack(() => data.form), {
    validators: zod4Client(createPersonalAppSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
  });

  const agentIdError = $derived($errors.agentId?.[0] ?? null);
  const nameError = $derived($errors.name?.[0] ?? null);
  const urnError = $derived($errors.urn?.[0] ?? null);
  const appTypeError = $derived($errors.appType?.[0] ?? null);
  const actionError = $derived($formMessage?.type === 'error' ? $formMessage.text : null);

  // When the picked agent changes, seed the name + URN slug from it (the server
  // resolves collisions and the user can still edit both).
  function onAgentChange(id: string) {
    const a = agents.find((x) => x.id === id);
    if (!a) return;
    appForm.update((cur) => ({ ...cur, name: a.name, urn: agentSlugFromUrn(a.urn) }), { taint: false });
  }

  const inputClass =
    'w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500';

  const selectedAgent = $derived<InstallableAgent | null>(
    agents.find((a) => a.id === $appForm.agentId) ?? null,
  );
</script>

<svelte:head><title>{t('my-apps.new.title', 'New app — Hadron')}</title></svelte:head>

<div class="mx-auto max-w-2xl space-y-6 py-6">
  <div>
    <h1 class="text-2xl font-bold text-zinc-900 dark:text-white">{t('my-apps.new.heading', 'New app')}</h1>
    <p class="mt-1 text-sm text-zinc-500">
      {t('my-apps.new.subhead', 'Install one of your personal agents or a public agent as an app you own.')}
    </p>
  </div>

  {#if !handle}
    <div role="alert" class="rounded-xl border border-amber-300 bg-amber-50 p-6 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
      {t('my-apps.new.no-handle', 'Your account needs a handle before you can create a personal app. Set one in your profile, then come back.')}
    </div>
  {:else if agents.length === 0}
    <div class="rounded-xl border border-dashed border-zinc-300 bg-white p-10 text-center dark:border-zinc-700 dark:bg-zinc-900">
      <p class="text-sm text-zinc-600 dark:text-zinc-400">{t('my-apps.new.no-agents', "You don't have any agents to install yet.")}</p>
      <a href="/app/agents/new" class="mt-4 inline-block rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">{t('my-apps.new.create-agent', 'Create an agent first')}</a>
    </div>
  {:else}
    {#if actionError}
      <div role="alert" class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
        {actionError}
      </div>
    {/if}

    <div class="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
      <form method="POST" use:enhance class="space-y-4" novalidate>
        <input type="hidden" name="_kind" value={$appForm._kind} />

        <div>
          <label for="agentId" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {t('my-apps.new.field.agent', 'Agent')}
          </label>
          <select
            id="agentId"
            name="agentId"
            bind:value={$appForm.agentId}
            onchange={(e) => onAgentChange((e.currentTarget as HTMLSelectElement).value)}
            aria-invalid={!!agentIdError}
            aria-describedby={agentIdError ? 'agentIdError' : undefined}
            class="{inputClass} {agentIdError ? 'border-red-500 focus:border-red-500' : ''}"
          >
            {#each agents as a (a.id)}
              <option value={a.id}>{a.name} ({a.urn})</option>
            {/each}
          </select>
          {#if selectedAgent}
            <div class="mt-1"><Urn value={selectedAgent.urn} type="agent" size={10} /></div>
            {#if selectedAgent.description}
              <p class="mt-1 text-xs text-zinc-500">{selectedAgent.description}</p>
            {/if}
          {/if}
          {#if agentIdError}
            <p id="agentIdError" role="alert" class="mt-1 text-xs text-red-600 dark:text-red-400">{agentIdError}</p>
          {/if}
        </div>

        <div>
          <label for="name" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {t('my-apps.new.field.name', 'App name')}
          </label>
          <input
            id="name"
            type="text"
            name="name"
            bind:value={$appForm.name}
            aria-invalid={!!nameError}
            {...$constraints.name}
            class="{inputClass} {nameError ? 'border-red-500 focus:border-red-500' : ''}"
          />
          {#if nameError}
            <p role="alert" class="mt-1 text-xs text-red-600 dark:text-red-400">{nameError}</p>
          {/if}
        </div>

        <div>
          <label for="urn" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {t('my-apps.new.field.urn', 'URN')}
          </label>
          <div class="flex items-stretch">
            <span class="inline-flex items-center rounded-l-lg border border-r-0 border-zinc-300 bg-zinc-100 px-3 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">{handle}:</span>
            <input
              id="urn"
              type="text"
              name="urn"
              bind:value={$appForm.urn}
              aria-invalid={!!urnError}
              {...$constraints.urn}
              class="w-full rounded-r-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500 {urnError ? 'border-red-500 focus:border-red-500' : ''}"
            />
          </div>
          <p class="mt-1 text-xs text-zinc-400">{t('my-apps.new.field.urn.help', 'Must be unique among your apps.')}</p>
          {#if urnError}
            <p role="alert" class="mt-1 text-xs text-red-600 dark:text-red-400">{urnError}</p>
          {/if}
        </div>

        <div>
          <label for="appType" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {t('my-apps.new.field.appType', 'App type')}
          </label>
          <select
            id="appType"
            name="appType"
            bind:value={$appForm.appType}
            aria-invalid={!!appTypeError}
            class="{inputClass} {appTypeError ? 'border-red-500 focus:border-red-500' : ''}"
          >
            <option value="WORKSTATION">💻 Workstation</option>
            <option value="CHATBOT">💬 Chatbot</option>
            <option value="AGENT">🤖 Agent</option>
            <option value="AUTOMATION">⚙️ Automation</option>
            <option value="CLOUD">☁️ Cloud</option>
            <option value="IOT">📡 IoT</option>
          </select>
          {#if appTypeError}
            <p role="alert" class="mt-1 text-xs text-red-600 dark:text-red-400">{appTypeError}</p>
          {/if}
        </div>

        <div class="flex items-center gap-2 pt-2">
          <button
            type="submit"
            disabled={!$appForm.agentId || !$appForm.name.trim() || !$appForm.urn.trim() || $submitting}
            class="rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            style="background: #fb8500;"
          >
            {$submitting ? t('my-apps.new.submitting', 'Creating…') : t('my-apps.new.submit', 'Create app')}
          </button>
          <a
            href="/app/apps"
            class="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {t('my-apps.new.cancel', 'Cancel')}
          </a>
        </div>
      </form>
    </div>
  {/if}
</div>
