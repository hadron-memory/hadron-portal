<script lang="ts">
  // #336: Integrations tab — GitHub App + Microsoft Exchange + AI service
  // configs. The GitHub/Exchange markup moved here from the org dashboard
  // (+page.svelte); the AI section moved from the standalone /ai-configs route.
  import { page } from '$app/stores';
  import { env } from '$env/dynamic/public';
  import { untrack } from 'svelte';
  import { superForm, type Infer, type SuperValidated } from 'sveltekit-superforms';
  import { zod4Client } from 'sveltekit-superforms/adapters';
  import AiServiceConfigSection from '$lib/components/AiServiceConfigSection.svelte';
  import { scopedActionError, scopedActionSuccess } from '$lib/forms/scoped-message';
  import { submittedForm } from '$lib/forms/submitted-form';
  import { t } from '$lib/i18n/t';
  import type { PageData, ActionData } from './$types';
  import {
    connectExchangeSchema,
    deleteExchangeConnectionSchema,
    githubAppCredentialsSchema,
    githubInstallationSchema,
    testExchangeConnectionSchema,
    unlinkGithubSchema,
  } from './schema';

  type GithubAppCredentialsForm = Infer<typeof githubAppCredentialsSchema, 'zod4'>;
  type GithubInstallationForm = Infer<typeof githubInstallationSchema, 'zod4'>;
  type UnlinkGithubForm = Infer<typeof unlinkGithubSchema, 'zod4'>;
  type ConnectExchangeForm = Infer<typeof connectExchangeSchema, 'zod4'>;
  type TestExchangeConnectionForm = Infer<typeof testExchangeConnectionSchema, 'zod4'>;
  type DeleteExchangeConnectionForm = Infer<typeof deleteExchangeConnectionSchema, 'zod4'>;
  type GithubAppCredentialsSuperform = SuperValidated<
    GithubAppCredentialsForm,
    App.Superforms.Message,
    GithubAppCredentialsForm
  >;
  type GithubInstallationSuperform = SuperValidated<
    GithubInstallationForm,
    App.Superforms.Message,
    GithubInstallationForm
  >;
  type UnlinkGithubSuperform = SuperValidated<UnlinkGithubForm, App.Superforms.Message, UnlinkGithubForm>;
  type ConnectExchangeSuperform = SuperValidated<ConnectExchangeForm, App.Superforms.Message, ConnectExchangeForm>;
  type TestExchangeConnectionSuperform = SuperValidated<TestExchangeConnectionForm, App.Superforms.Message, TestExchangeConnectionForm>;
  type DeleteExchangeConnectionSuperform = SuperValidated<DeleteExchangeConnectionForm, App.Superforms.Message, DeleteExchangeConnectionForm>;

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const org = $derived(data.org);

  const appSlug = env.PUBLIC_HADRON_GITHUB_APP_SLUG;
  const hasOfficialApp = $derived(!!appSlug);
  const isUsingCustomApp = $derived(!!org.githubAppId);
  let showCustomSetup = $state(false);
  let showSetupGuide = $state(false);
  let selectedIntegration = $state('');
  const hasGithubConfigured = $derived(!!org.githubInstallationId || isUsingCustomApp);

  let showGithubConfig = $state(false);
  // Native POST validation should reveal the submitted GitHub panel, but a
  // later user close should not be forced by us unless another action arrives.
  $effect(() => {
    if (
      submittedForm<GithubAppCredentialsForm>(form, 'updateGithubApp') ||
      submittedForm<GithubInstallationForm>(form, 'linkGithub')
    ) {
      showGithubConfig = true;
    }
  });

  // Exchange integration state
  let showExchangeSetup = $state(false);

  const installUrl = $derived(
    appSlug
      ? `https://github.com/apps/${appSlug}/installations/new?state=${org.id}`
      : null,
  );

  // Show success after callback redirect
  const justInstalled = $derived($page.url.searchParams.get('githubInstalled') === '1');

  function afterIntegrationFormUpdate() {
    showSetupGuide = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const initialGithubAppForm = untrack(() => submittedForm<GithubAppCredentialsForm>(form, 'updateGithubApp') as GithubAppCredentialsSuperform | null ?? data.githubAppForm);
  const {
    form: githubAppForm,
    errors: githubAppErrors,
    constraints: githubAppConstraints,
    message: githubAppMessage,
    submitting: githubAppSubmitting,
    enhance: githubAppEnhance,
  } = superForm<GithubAppCredentialsForm, App.Superforms.Message, GithubAppCredentialsForm>(initialGithubAppForm, {
    validators: zod4Client(githubAppCredentialsSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
    onUpdated: afterIntegrationFormUpdate,
  });
  const githubAppIdError = $derived($githubAppErrors.appId?.[0] ?? null);
  const githubPrivateKeyError = $derived($githubAppErrors.privateKey?.[0] ?? null);
  const githubAppActionError = $derived(scopedActionError<GithubAppCredentialsForm>(form, 'updateGithubApp', $githubAppMessage));
  const githubAppActionSuccess = $derived(scopedActionSuccess<GithubAppCredentialsForm>(form, 'updateGithubApp', $githubAppMessage));

  const initialGithubInstallationForm = untrack(() => submittedForm<GithubInstallationForm>(form, 'linkGithub') as GithubInstallationSuperform | null ?? data.githubInstallationForm);
  const {
    form: githubInstallationForm,
    errors: githubInstallationErrors,
    constraints: githubInstallationConstraints,
    message: githubInstallationMessage,
    submitting: githubInstallationSubmitting,
    enhance: githubInstallationEnhance,
  } = superForm<GithubInstallationForm, App.Superforms.Message, GithubInstallationForm>(initialGithubInstallationForm, {
    validators: zod4Client(githubInstallationSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
    onUpdated: afterIntegrationFormUpdate,
  });
  const githubInstallationError = $derived($githubInstallationErrors.installationId?.[0] ?? null);
  const githubInstallationActionError = $derived(scopedActionError<GithubInstallationForm>(form, 'linkGithub', $githubInstallationMessage));
  const githubInstallationActionSuccess = $derived(scopedActionSuccess<GithubInstallationForm>(form, 'linkGithub', $githubInstallationMessage));

  const initialUnlinkGithubForm = untrack(() => submittedForm<UnlinkGithubForm>(form, 'unlinkGithub') as UnlinkGithubSuperform | null ?? data.unlinkGithubForm);
  const {
    form: unlinkGithubForm,
    errors: unlinkGithubErrors,
    message: unlinkGithubMessage,
    submitting: unlinkGithubSubmitting,
    enhance: unlinkGithubEnhance,
  } = superForm<UnlinkGithubForm, App.Superforms.Message, UnlinkGithubForm>(initialUnlinkGithubForm, {
    validators: zod4Client(unlinkGithubSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
    onUpdated: afterIntegrationFormUpdate,
  });
  const initialConnectExchangeForm = untrack(() => submittedForm<ConnectExchangeForm>(form, 'connectExchange') as ConnectExchangeSuperform | null ?? data.connectExchangeForm);
  const {
    form: connectExchangeForm,
    errors: connectExchangeErrors,
    message: connectExchangeMessage,
    submitting: connectExchangeSubmitting,
    enhance: connectExchangeEnhance,
  } = superForm<ConnectExchangeForm, App.Superforms.Message, ConnectExchangeForm>(initialConnectExchangeForm, {
    validators: zod4Client(connectExchangeSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
    onUpdated: afterIntegrationFormUpdate,
  });
  const initialTestExchangeConnectionForm = untrack(() => submittedForm<TestExchangeConnectionForm>(form, 'testExchangeConnection') as TestExchangeConnectionSuperform | null ?? data.testExchangeConnectionForm);
  const {
    form: testExchangeConnectionForm,
    errors: testExchangeConnectionErrors,
    message: testExchangeConnectionMessage,
    submitting: testExchangeConnectionSubmitting,
    enhance: testExchangeConnectionEnhance,
  } = superForm<TestExchangeConnectionForm, App.Superforms.Message, TestExchangeConnectionForm>(initialTestExchangeConnectionForm, {
    validators: zod4Client(testExchangeConnectionSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
    onUpdated: afterIntegrationFormUpdate,
  });
  const initialDeleteExchangeConnectionForm = untrack(() => submittedForm<DeleteExchangeConnectionForm>(form, 'deleteExchangeConnection') as DeleteExchangeConnectionSuperform | null ?? data.deleteExchangeConnectionForm);
  const {
    form: deleteExchangeConnectionForm,
    errors: deleteExchangeConnectionErrors,
    message: deleteExchangeConnectionMessage,
    submitting: deleteExchangeConnectionSubmitting,
    enhance: deleteExchangeConnectionEnhance,
  } = superForm<DeleteExchangeConnectionForm, App.Superforms.Message, DeleteExchangeConnectionForm>(initialDeleteExchangeConnectionForm, {
    validators: zod4Client(deleteExchangeConnectionSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
    onUpdated: afterIntegrationFormUpdate,
  });

  function setTestExchangeConnection(connectionId: string) {
    testExchangeConnectionForm.update((current) => ({ ...current, connectionId }), { taint: false });
  }

  function setDeleteExchangeConnection(connectionId: string) {
    deleteExchangeConnectionForm.update((current) => ({ ...current, connectionId }), { taint: false });
  }

  const unlinkGithubActionError = $derived(scopedActionError<UnlinkGithubForm>(form, 'unlinkGithub', $unlinkGithubMessage, $unlinkGithubErrors));
  const unlinkGithubActionSuccess = $derived(scopedActionSuccess<UnlinkGithubForm>(form, 'unlinkGithub', $unlinkGithubMessage));
  const connectExchangeActionError = $derived(scopedActionError<ConnectExchangeForm>(form, 'connectExchange', $connectExchangeMessage, $connectExchangeErrors));
  const testExchangeConnectionActionError = $derived(scopedActionError<TestExchangeConnectionForm>(form, 'testExchangeConnection', $testExchangeConnectionMessage, $testExchangeConnectionErrors, ['connectionId', '_kind']));
  const testExchangeConnectionActionSuccess = $derived(scopedActionSuccess<TestExchangeConnectionForm>(form, 'testExchangeConnection', $testExchangeConnectionMessage));
  const deleteExchangeConnectionActionError = $derived(scopedActionError<DeleteExchangeConnectionForm>(form, 'deleteExchangeConnection', $deleteExchangeConnectionMessage, $deleteExchangeConnectionErrors, ['connectionId', '_kind']));
  const deleteExchangeConnectionActionSuccess = $derived(scopedActionSuccess<DeleteExchangeConnectionForm>(form, 'deleteExchangeConnection', $deleteExchangeConnectionMessage));
</script>

<svelte:head><title>Integrations · {org.name} · Hadron</title></svelte:head>

<div class="space-y-8">
  <!-- Integrations -->
  <section>
    <h1 class="mb-3 font-semibold text-zinc-900 dark:text-white">Integrations</h1>

    {#if githubInstallationActionSuccess}
      <div role="status" class="mb-3 rounded-lg border border-green-800 bg-green-950 px-4 py-3 text-sm text-green-300">{githubInstallationActionSuccess}</div>
    {/if}
    {#if githubAppActionSuccess}
      <div role="status" class="mb-3 rounded-lg border border-green-800 bg-green-950 px-4 py-3 text-sm text-green-300">{githubAppActionSuccess}</div>
    {/if}
    {#if unlinkGithubActionError}
      <div role="alert" class="mb-3 rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{unlinkGithubActionError}</div>
    {:else if unlinkGithubActionSuccess}
      <div role="status" class="mb-3 rounded-lg border border-green-800 bg-green-950 px-4 py-3 text-sm text-green-300">{unlinkGithubActionSuccess}</div>
    {/if}
    {#if justInstalled}
      <div role="status" class="mb-3 rounded-lg border border-green-800 bg-green-950 px-4 py-3 text-sm text-green-300">Hadron GitHub App installed and linked to this organization.</div>
    {/if}
    {#if connectExchangeActionError}
      <div role="alert" class="mb-3 rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{connectExchangeActionError}</div>
    {/if}
    {#if $page.url.searchParams.get('exchangeConnected') === '1'}
      <div role="status" class="mb-3 rounded-lg border border-green-800 bg-green-950 px-4 py-3 text-sm text-green-300">Microsoft Exchange connected successfully.</div>
    {/if}
    {#if $page.url.searchParams.get('exchangeError')}
      <div role="alert" class="mb-3 rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">Exchange error: {$page.url.searchParams.get('exchangeError')}</div>
    {/if}
    {#if deleteExchangeConnectionActionError}
      <div role="alert" class="mb-3 rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{deleteExchangeConnectionActionError}</div>
    {:else if deleteExchangeConnectionActionSuccess}
      <div role="status" class="mb-3 rounded-lg border border-green-800 bg-green-950 px-4 py-3 text-sm text-green-300">{deleteExchangeConnectionActionSuccess}</div>
    {/if}
    {#if testExchangeConnectionActionError}
      <div role="alert" class="mb-3 rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{testExchangeConnectionActionError}</div>
    {:else if testExchangeConnectionActionSuccess}
      <div role="status" class="mb-3 rounded-lg border border-green-800 bg-green-950 px-4 py-3 text-sm text-green-300">{testExchangeConnectionActionSuccess}</div>
    {/if}

    <!-- Configured integrations -->
    {#if hasGithubConfigured}
      <div class="mb-4 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" class="text-zinc-700 dark:text-zinc-300"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
            <div>
              <p class="text-sm font-medium text-zinc-900 dark:text-white">GitHub</p>
              <div class="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                <span class="inline-block h-2 w-2 rounded-full {org.githubInstallationId ? 'bg-green-500' : 'bg-amber-500'}"></span>
                {#if org.githubInstallationId}
                  Connected <span class="font-mono">(#{org.githubInstallationId})</span>
                {:else}
                  Credentials saved, needs installation ID
                {/if}
              </div>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <button
              onclick={() => { showGithubConfig = !showGithubConfig; selectedIntegration = ''; }}
              class="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              {showGithubConfig ? 'Hide' : 'Edit'}
            </button>
            <form method="POST" action="?/unlinkGithub" use:unlinkGithubEnhance novalidate
              onsubmit={(e) => { if (!confirm('Disconnect GitHub? This removes the installation ID and any stored credentials.')) e.preventDefault(); }}
            >
              <input type="hidden" name="_kind" value={$unlinkGithubForm._kind} />
              <button type="submit" disabled={$unlinkGithubSubmitting} class="rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950">Disconnect</button>
            </form>
          </div>
        </div>

        {#if showGithubConfig}
          <div class="mt-4 border-t border-zinc-200 pt-4 dark:border-zinc-800">
            {@render githubConfigPanel()}
          </div>
        {/if}
      </div>
    {/if}

    <!-- Configured Exchange connections -->
    {#each org.exchangeConnections ?? [] as conn (conn.id)}
      <div class="mb-4 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-zinc-700 dark:text-zinc-300"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 7l-10 7L2 7"/></svg>
            <div>
              <p class="text-sm font-medium text-zinc-900 dark:text-white">Microsoft Exchange</p>
              <div class="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                <span class="inline-block h-2 w-2 rounded-full {conn.syncStatus === 'OK' ? 'bg-green-500' : conn.syncStatus === 'ERROR' ? 'bg-red-500' : 'bg-amber-500'}"></span>
                {#if conn.displayName}
                  <span>{conn.displayName}</span>
                  <span class="text-zinc-400">·</span>
                {/if}
                <span class="font-mono">{conn.mailboxEmail}</span>
                {#if conn.syncStatus === 'ERROR' && conn.lastError}
                  <span class="text-red-400">— {conn.lastError}</span>
                {/if}
              </div>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <a href="/app/orgs/{org.id}/exchange/{conn.id}"
              class="rounded-md border border-indigo-300 px-3 py-1.5 text-xs font-medium text-indigo-600 hover:bg-indigo-50 dark:border-indigo-800 dark:text-indigo-400 dark:hover:bg-indigo-950">
              Inbox
            </a>
            <!-- Click updates before Superforms client validation; submit covers keyboard/requestSubmit paths. -->
            <form method="POST" action="?/testExchangeConnection" use:testExchangeConnectionEnhance onsubmit={() => setTestExchangeConnection(conn.id)} novalidate>
              <input type="hidden" name="_kind" value={$testExchangeConnectionForm._kind} />
              <input type="hidden" name="connectionId" value={conn.id} />
              <button type="submit" disabled={$testExchangeConnectionSubmitting} onclick={() => setTestExchangeConnection(conn.id)} class="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">Test</button>
            </form>
            <form method="POST" action="?/deleteExchangeConnection" use:deleteExchangeConnectionEnhance novalidate
              onsubmit={(e) => { setDeleteExchangeConnection(conn.id); if (!confirm('Disconnect this Microsoft account?')) e.preventDefault(); }}
            >
              <input type="hidden" name="_kind" value={$deleteExchangeConnectionForm._kind} />
              <input type="hidden" name="connectionId" value={conn.id} />
              <button type="submit" disabled={$deleteExchangeConnectionSubmitting} onclick={() => setDeleteExchangeConnection(conn.id)} class="rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950">Disconnect</button>
            </form>
          </div>
        </div>
        {#if conn.lastSyncAt}
          <p class="mt-2 text-xs text-zinc-500">Last verified: {new Date(conn.lastSyncAt).toLocaleString()}</p>
        {/if}
      </div>
    {/each}

    <!-- Add integration -->
    <div class="flex items-center gap-3">
      <label for="addIntegration" class="text-sm text-zinc-600 dark:text-zinc-400">Add:</label>
      <select
        id="addIntegration"
        bind:value={selectedIntegration}
        class="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
      >
        <option value="">Select integration...</option>
        {#if !hasGithubConfigured}
          <option value="github">GitHub</option>
        {/if}
        <option value="exchange">Microsoft Exchange</option>
      </select>
      <button
        onclick={() => {
          if (selectedIntegration === 'github') { showGithubConfig = true; showExchangeSetup = false; }
          else if (selectedIntegration === 'exchange') { showExchangeSetup = true; showGithubConfig = false; }
        }}
        disabled={!selectedIntegration}
        class="rounded-lg px-4 py-1.5 text-sm font-medium transition
          {selectedIntegration
            ? 'bg-amber-500 text-white hover:bg-amber-600'
            : 'bg-zinc-200 text-zinc-400 cursor-not-allowed dark:bg-zinc-800 dark:text-zinc-600'}"
      >
        Configure
      </button>
    </div>

    <!-- GitHub config panel (when adding new) -->
    {#if showGithubConfig && !hasGithubConfigured}
      <div class="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 p-5 dark:border-zinc-800 dark:bg-zinc-900/50">
        {@render githubConfigPanel()}
      </div>
    {/if}

    <!-- Exchange setup panel -->
    {#if showExchangeSetup}
      <div class="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 p-5 dark:border-zinc-800 dark:bg-zinc-900/50">
        <h3 class="mb-1 text-sm font-medium text-zinc-900 dark:text-white">Connect Microsoft Exchange</h3>
        <p class="mb-4 text-sm text-zinc-500">
          Sign in with your Microsoft account to grant Hadron access to your email.
          You'll be redirected to Microsoft to authorize the connection.
        </p>
        <div class="flex items-center gap-3">
          <form method="POST" action="?/connectExchange" use:connectExchangeEnhance novalidate>
            <input type="hidden" name="_kind" value={$connectExchangeForm._kind} />
            <button type="submit" disabled={$connectExchangeSubmitting}
              class="inline-flex items-center gap-2 rounded-lg bg-[#2f2f2f] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#404040] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-100"
            >
              <svg width="16" height="16" viewBox="0 0 23 23" fill="none"><path fill="#f35325" d="M1 1h10v10H1z"/><path fill="#81bc06" d="M12 1h10v10H12z"/><path fill="#05a6f0" d="M1 12h10v10H1z"/><path fill="#ffba08" d="M12 12h10v10H12z"/></svg>
              {$connectExchangeSubmitting ? 'Starting...' : 'Sign in with Microsoft'}
            </button>
          </form>
          <button type="button" onclick={() => { showExchangeSetup = false; selectedIntegration = ''; }}
            class="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
            Cancel
          </button>
        </div>
      </div>
    {/if}
  </section>

  <!-- AI providers -->
  <section>
    <AiServiceConfigSection
      ownerType="ORGANIZATION"
      ownerId={org.id}
      ownerLabel={org.name}
      configs={data.configs}
      members={org.members ?? []}
      currentUserId={data.currentUserId}
      configsError={data.configsError}
    />
  </section>
</div>

{#snippet githubConfigPanel()}
  <!-- Official Hadron App (1-click install) -->
  {#if hasOfficialApp && !isUsingCustomApp}
    {#if org.githubInstallationId}
      <div class="mb-4 rounded-xl border border-green-200 bg-green-50 p-4 dark:border-green-900 dark:bg-green-950">
        <div class="flex items-center gap-3">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-green-600 dark:text-green-400"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
          <div>
            <p class="text-sm font-medium text-green-800 dark:text-green-300">Hadron GitHub App is installed</p>
            <p class="text-xs text-green-600 dark:text-green-400">Repo syncing is enabled for this organization.</p>
          </div>
        </div>
        {#if installUrl}
          <a
            href={installUrl}
            class="mt-3 inline-block text-xs text-green-700 underline hover:text-green-600 dark:text-green-400 dark:hover:text-green-300"
          >Manage repository access</a>
        {/if}
      </div>
    {:else}
      <div class="mb-4">
        <p class="mb-3 text-sm text-zinc-600 dark:text-zinc-400">
          Install the Hadron GitHub App to allow syncing memories from your repositories. You'll choose which repositories to grant access to.
        </p>
        {#if installUrl}
          <a
            href={installUrl}
            class="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-100"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
            Install Hadron GitHub App
          </a>
        {/if}
      </div>
    {/if}
  {/if}

  <!-- Custom App toggle (when official app is available) -->
  {#if hasOfficialApp}
    <div class="mb-4">
      <button
        onclick={() => showCustomSetup = !showCustomSetup}
        class="flex items-center gap-2 text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
          class="transition-transform {showCustomSetup ? 'rotate-90' : ''}"
        ><polyline points="9 18 15 12 9 6"></polyline></svg>
        {isUsingCustomApp ? 'Custom GitHub App settings' : 'Use your own GitHub App instead'}
      </button>
    </div>
  {/if}

  <!-- Custom App setup -->
  {#if !hasOfficialApp || showCustomSetup || isUsingCustomApp}
    <div class="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
      {#if hasOfficialApp}
        <p class="mb-4 text-sm text-zinc-500">
          For GitHub Enterprise Server or full credential isolation, you can configure your own GitHub App.
        </p>
      {:else}
        <p class="mb-4 text-sm text-zinc-500">
          Configure a GitHub App to enable memory syncing from your repositories.
        </p>
      {/if}

      <!-- Setup guide (collapsible) -->
      <div class="mb-5">
        <button
          onclick={() => showSetupGuide = !showSetupGuide}
          class="flex items-center gap-2 text-sm font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
            class="transition-transform {showSetupGuide ? 'rotate-90' : ''}"
          ><polyline points="9 18 15 12 9 6"></polyline></svg>
          {showSetupGuide ? 'Hide setup guide' : 'Show setup guide'}
        </button>
        {#if showSetupGuide}
          <div class="mt-3 rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm dark:border-zinc-700 dark:bg-zinc-800">
            <h3 class="mb-3 font-semibold text-zinc-900 dark:text-white">How to set up your own GitHub App</h3>
            <ol class="list-inside list-decimal space-y-4 text-zinc-700 dark:text-zinc-300">
              <li>
                <span class="font-medium">Create a GitHub App</span>
                <ul class="ml-6 mt-1 list-disc space-y-1 text-zinc-500 dark:text-zinc-400">
                  <li>Go to your GitHub organization's Settings &rarr; Developer settings &rarr; GitHub Apps &rarr; New GitHub App</li>
                  <li>Or for a personal account: Settings &rarr; Developer settings &rarr; GitHub Apps &rarr; New GitHub App</li>
                  <li>Give it a name (e.g. <code class="rounded bg-zinc-200 px-1.5 py-0.5 font-mono text-xs dark:bg-zinc-800">my-org-hadron-sync</code>)</li>
                  <li>Set the Homepage URL to any URL (e.g. your company website)</li>
                  <li>Under Webhook, set the URL to <code class="rounded bg-zinc-200 px-1.5 py-0.5 font-mono text-xs dark:bg-zinc-800">https://&lt;your-server&gt;/github/webhook</code> and set a webhook secret (must match <code class="rounded bg-zinc-200 px-1.5 py-0.5 font-mono text-xs dark:bg-zinc-800">GITHUB_WEBHOOK_SECRET</code> in the server)</li>
                  <li>Subscribe to <span class="font-medium text-zinc-700 dark:text-zinc-300">Push</span> events (for auto-sync on merge)</li>
                  <li>Under Repository permissions, set <span class="font-medium text-zinc-700 dark:text-zinc-300">Contents</span> to <span class="font-medium text-zinc-700 dark:text-zinc-300">Read & write</span> (needed for creating PRs with memory changes)</li>
                  <li>Under "Where can this GitHub App be installed?", select "Only on this account"</li>
                  <li>Click "Create GitHub App"</li>
                </ul>
              </li>
              <li>
                <span class="font-medium">Note the App ID</span>
                <ul class="ml-6 mt-1 list-disc space-y-1 text-zinc-500 dark:text-zinc-400">
                  <li>After creation, you'll see the <span class="font-medium text-zinc-700 dark:text-zinc-300">App ID</span> near the top of the page</li>
                  <li>Paste it into the "App ID" field below</li>
                </ul>
              </li>
              <li>
                <span class="font-medium">Generate a private key</span>
                <ul class="ml-6 mt-1 list-disc space-y-1 text-zinc-500 dark:text-zinc-400">
                  <li>On the same page, scroll to "Private keys" and click "Generate a private key"</li>
                  <li>A <code class="rounded bg-zinc-200 px-1.5 py-0.5 font-mono text-xs dark:bg-zinc-800">.pem</code> file will download</li>
                  <li>Paste the entire file contents (including BEGIN/END lines) into the "Private Key" field below</li>
                </ul>
              </li>
              <li>
                <span class="font-medium">Install the app</span>
                <ul class="ml-6 mt-1 list-disc space-y-1 text-zinc-500 dark:text-zinc-400">
                  <li>Back on GitHub, click "Install App" in the left sidebar, then click "Install"</li>
                  <li>Select the repositories that contain Hadron memories</li>
                  <li>After installing, check the URL &mdash; it ends with <code class="rounded bg-zinc-200 px-1.5 py-0.5 font-mono text-xs dark:bg-zinc-800">/installations/XXXXXXXX</code></li>
                  <li>That number is your <span class="font-medium text-zinc-700 dark:text-zinc-300">Installation ID</span> &mdash; enter it below</li>
                </ul>
              </li>
            </ol>
          </div>
        {/if}
      </div>

      <!-- App Credentials -->
      <div class="mb-5">
        <h3 class="mb-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">App Credentials</h3>
        {#if org.githubAppId && org.hasGithubAppPrivateKey}
          <p class="mb-3 text-sm text-zinc-600 dark:text-zinc-400">
            App ID: <code class="font-mono text-zinc-900 dark:text-zinc-200">{org.githubAppId}</code>
            <span class="ml-2 rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900 dark:text-green-300">Private key stored</span>
          </p>
        {:else if org.githubAppId}
          <p class="mb-3 text-sm text-zinc-600 dark:text-zinc-400">
            App ID: <code class="font-mono text-zinc-900 dark:text-zinc-200">{org.githubAppId}</code>
            <span class="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-900 dark:text-amber-300">Missing private key</span>
          </p>
        {/if}
        <form method="POST" action="?/updateGithubApp" use:githubAppEnhance class="max-w-lg space-y-3" novalidate>
          <input type="hidden" name="_kind" value={$githubAppForm._kind} />
          {#if githubAppActionError}
            <div role="alert" class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{githubAppActionError}</div>
          {/if}
          <div>
            <label for="appId" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">App ID</label>
            <input id="appId" name="appId" type="text"
              bind:value={$githubAppForm.appId}
              placeholder="e.g. 123456"
              aria-invalid={!!githubAppIdError}
              aria-describedby={githubAppIdError ? 'appIdError' : undefined}
              {...$githubAppConstraints.appId}
              class="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none {githubAppIdError ? 'border-red-500 focus:border-red-500' : ''}" />
            {#if githubAppIdError}
              <p id="appIdError" role="alert" class="mt-1 text-xs text-red-600 dark:text-red-400">{githubAppIdError}</p>
            {/if}
          </div>
          <div>
            <label for="privateKey" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">Private Key (PEM)</label>
            <textarea id="privateKey" name="privateKey" rows="6"
              bind:value={$githubAppForm.privateKey}
              placeholder="-----BEGIN RSA PRIVATE KEY-----&#10;...&#10;-----END RSA PRIVATE KEY-----"
              aria-invalid={!!githubPrivateKeyError}
              aria-describedby={githubPrivateKeyError ? 'privateKeyError privateKeyHint' : 'privateKeyHint'}
              {...$githubAppConstraints.privateKey}
              class="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-xs text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none {githubPrivateKeyError ? 'border-red-500 focus:border-red-500' : ''}"></textarea>
            <p id="privateKeyHint" class="mt-1 text-xs text-zinc-500">Encrypted at rest. Never displayed after saving.</p>
            {#if githubPrivateKeyError}
              <p id="privateKeyError" role="alert" class="mt-1 text-xs text-red-600 dark:text-red-400">{githubPrivateKeyError}</p>
            {/if}
          </div>
          <button type="submit" disabled={$githubAppSubmitting} class="rounded-lg bg-zinc-200 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-300 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-700 dark:text-white dark:hover:bg-zinc-600">
            {$githubAppSubmitting ? 'Saving...' : org.githubAppId ? 'Update Credentials' : 'Save Credentials'}
          </button>
        </form>
      </div>

      <!-- Installation ID -->
      <div>
        <h3 class="mb-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">Installation ID</h3>
        {#if org.githubInstallationId}
          <p class="mb-3 text-sm text-zinc-600 dark:text-zinc-400">Current: <code class="font-mono text-zinc-900 dark:text-zinc-200">{org.githubInstallationId}</code></p>
        {/if}
        <form method="POST" action="?/linkGithub" use:githubInstallationEnhance class="flex items-start gap-3 max-w-md" novalidate>
          <input type="hidden" name="_kind" value={$githubInstallationForm._kind} />
          <div class="flex-1">
            <label for="installationId" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">Installation ID</label>
            <input id="installationId" name="installationId" type="text" inputmode="numeric"
              bind:value={$githubInstallationForm.installationId}
              placeholder="e.g. 12345678"
              aria-invalid={!!githubInstallationError}
              aria-describedby={githubInstallationError ? 'installationIdError' : undefined}
              {...$githubInstallationConstraints.installationId}
              class="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none {githubInstallationError ? 'border-red-500 focus:border-red-500' : ''}" />
            {#if githubInstallationError}
              <p id="installationIdError" role="alert" class="mt-1 text-xs text-red-600 dark:text-red-400">{githubInstallationError}</p>
            {/if}
            {#if githubInstallationActionError}
              <p role="alert" class="mt-2 text-xs text-red-600 dark:text-red-400">{githubInstallationActionError}</p>
            {/if}
          </div>
          <button type="submit" disabled={$githubInstallationSubmitting} class="rounded-lg bg-zinc-200 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-300 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-700 dark:text-white dark:hover:bg-zinc-600">
            {$githubInstallationSubmitting ? 'Saving...' : org.githubInstallationId ? 'Update' : 'Save'}
          </button>
        </form>
      </div>
    </div>
  {/if}
{/snippet}
