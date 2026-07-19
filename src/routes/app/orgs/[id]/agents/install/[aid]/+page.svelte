<script lang="ts">
  import { untrack } from 'svelte';
  import { superForm, type Infer, type SuperValidated } from 'sveltekit-superforms';
  import { zod4Client } from 'sveltekit-superforms/adapters';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import { t } from '$lib/i18n/t';
  import type { PageData, ActionData } from './$types';
  import { installAgentSchema } from './schema';

  type InstallAgentForm = Infer<typeof installAgentSchema, 'zod4'>;
  type InstallAgentSuperform = SuperValidated<InstallAgentForm, App.Superforms.Message, InstallAgentForm>;

  let { data, form }: { data: PageData; form: ActionData } = $props();

  const org = $derived(data.org);
  const agent = $derived(data.agent);

  function submittedInstall(actionData: ActionData): InstallAgentSuperform | null {
    const candidate = actionData && 'form' in actionData ? actionData.form : null;
    const candidateData = candidate?.data;
    const kind = candidateData && typeof candidateData === 'object' && '_kind' in candidateData
      ? String(candidateData._kind)
      : null;
    return kind === 'installAgent'
      ? candidate as InstallAgentSuperform
      : null;
  }

  const initialInstallForm = untrack(() => submittedInstall(form) ?? data.form);
  const {
    form: installForm,
    errors: installErrors,
    constraints: installConstraints,
    message: installMessage,
    submitting: installSubmitting,
    enhance: installEnhance,
  } = superForm<InstallAgentForm, App.Superforms.Message, InstallAgentForm>(initialInstallForm, {
    validators: zod4Client(installAgentSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
  });
  const nameError = $derived($installErrors.name?.[0] ?? null);
  const urnError = $derived($installErrors.urn?.[0] ?? null);
  const installActionError = $derived($installMessage?.type === 'error' ? $installMessage.text : null);

  const inputClass =
    'w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500';
</script>

<svelte:head><title>{t('install.page.title-prefix', 'Install')} {agent.name} · {org.name} · Hadron</title></svelte:head>

<div class="space-y-6">
  <div>
    <Breadcrumb items={[
      { label: 'Agents', href: `/app/orgs/${org.id}/agents` },
      { label: agent.name, href: `/app/agents/${agent.id}` },
      { label: t('install.breadcrumb.install', 'Install') },
    ]} />
    <h1 class="mt-2 text-2xl font-bold text-zinc-900 dark:text-white">
      {t('install.heading-prefix', 'Install')} {agent.name}
    </h1>
    <div class="mt-1">
      <Urn value={agent.urn} type="agent" />
    </div>
    {#if agent.description}
      <p class="mt-2 text-sm text-zinc-500">{agent.description}</p>
    {/if}
  </div>

  {#if installActionError}
    <div role="alert" class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
      {installActionError}
    </div>
  {/if}

  <div class="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
    <p class="mb-4 text-sm text-zinc-500">
      {t(
        'install.help',
        'Installing this Agent creates an App in your organization. You can mint App Keys and configure overrides afterward.',
      )}
    </p>
    <form method="POST" action="?/install" use:installEnhance class="space-y-4" novalidate>
      <input type="hidden" name="_kind" value={$installForm._kind} />
      <div>
        <label for="name" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          {t('install.field.name.label', 'App name')}
        </label>
        <input
          id="name"
          type="text"
          name="name"
          bind:value={$installForm.name}
          aria-invalid={!!nameError}
          aria-describedby={nameError ? 'installNameError installNameHelp' : 'installNameHelp'}
          {...$installConstraints.name}
          class="{inputClass} {nameError ? 'border-red-500 focus:border-red-500' : ''}"
        />
        <p id="installNameHelp" class="mt-1 text-xs text-zinc-400">
          {t('install.field.name.help', "Identifies this installation in your org. Defaulted from the Agent's name.")}
        </p>
        {#if nameError}
          <p id="installNameError" role="alert" class="mt-1 text-xs text-red-600 dark:text-red-400">{nameError}</p>
        {/if}
      </div>

      <div>
        <label for="urn" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          {t('install.field.urn.label', 'URN')}
        </label>
        <div class="flex items-stretch">
          <span class="inline-flex items-center rounded-l-lg border border-r-0 border-zinc-300 bg-zinc-100 px-3 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">
            {org.urn}:
          </span>
          <input
            id="urn"
            type="text"
            name="urn"
            bind:value={$installForm.urn}
            aria-invalid={!!urnError}
            aria-describedby={urnError ? 'installUrnError installUrnHelp' : 'installUrnHelp'}
            {...$installConstraints.urn}
            class="w-full rounded-r-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500 {urnError ? 'border-red-500 focus:border-red-500' : ''}"
          />
        </div>
        <p id="installUrnHelp" class="mt-1 text-xs text-zinc-400">
          {t('install.field.urn.help', 'Must be unique within your organization.')}
        </p>
        {#if urnError}
          <p id="installUrnError" role="alert" class="mt-1 text-xs text-red-600 dark:text-red-400">{urnError}</p>
        {/if}
      </div>

      <div>
        <label for="appType" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          {t('install.field.appType.label', 'App type')}
        </label>
        <select
          id="appType"
          name="appType"
          bind:value={$installForm.appType}
          class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
        >
          <option value="WORKSTATION">💻 Workstation</option>
          <option value="CHATBOT">💬 Chatbot</option>
          <option value="AGENT">🤖 Agent</option>
          <option value="AUTOMATION">⚙️ Automation</option>
          <option value="CLOUD">☁️ Cloud</option>
          <option value="IOT">📡 IoT</option>
        </select>
        <p class="mt-1 text-xs text-zinc-400">
          {t('install.field.appType.help', 'Surface the App targets — affects which UX flows apply.')}
        </p>
      </div>

      <!-- 009-install-agent-flow FR-012: install form intentionally omits AI
           configuration (provider/model/key). Inherits from the Agent at
           runtime; an App-level override is set later from the App manage page. -->

      <div class="flex items-center gap-2 pt-2">
        <button
          type="submit"
          disabled={!$installForm.name.trim() || !$installForm.urn.trim() || $installSubmitting}
          class="rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          style="background: #fb8500;"
        >
          {$installSubmitting ? t('install.submitting', 'Installing...') : t('install.submit', 'Install')}
        </button>
        <a
          href="/app/orgs/{org.id}/agents"
          class="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          {t('install.cancel', 'Cancel')}
        </a>
      </div>
    </form>
  </div>
</div>
