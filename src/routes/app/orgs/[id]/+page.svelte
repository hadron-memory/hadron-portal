<script lang="ts">
  import { page } from '$app/stores';
  import { enhance } from '$app/forms';
  import { env } from '$env/dynamic/public';
  import CopyUrn from '$lib/components/CopyUrn.svelte';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import type { PageData, ActionData } from './$types';
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

  const installUrl = $derived(
    appSlug
      ? `https://github.com/apps/${appSlug}/installations/new?state=${org.id}`
      : null,
  );

  // Show success after callback redirect
  const justInstalled = $derived($page.url.searchParams.get('githubInstalled') === '1');

  // Scroll to top and collapse guide after successful form actions
  function scrollEnhance(formEl: HTMLFormElement) {
    return enhance(formEl, () => {
      return async ({ update }) => {
        await update();
        showSetupGuide = false;
        window.scrollTo({ top: 0, behavior: 'smooth' });
      };
    });
  }
</script>

<svelte:head><title>{org.name} · Hadron</title></svelte:head>

<div class="space-y-8">
  <div class="flex items-start justify-between">
    <div>
      <Breadcrumb items={[
        { label: 'Organizations', href: '/app/orgs' },
        { label: org.name },
      ]} />
      <h1 class="mt-1 text-2xl font-bold text-zinc-900 dark:text-white">{org.name}</h1>
      <CopyUrn value={org.urn} />
    </div>
  </div>

  <!-- Members preview -->
  <section>
    <div class="mb-3 flex items-center justify-between">
      <h2 class="font-semibold text-zinc-900 dark:text-white">Members <span class="ml-1 text-sm font-normal text-zinc-500">({org.members?.length ?? 0})</span></h2>
      <a href="/app/orgs/{org.id}/members" class="text-sm text-indigo-600 hover:underline dark:text-indigo-400">Manage →</a>
    </div>
    <div class="flex flex-wrap gap-2">
      {#each (org.members ?? []).slice(0, 8) as m (m.id)}
        <div class="flex items-center gap-2 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-sm dark:border-zinc-800 dark:bg-zinc-900">
          {#if m.user.avatarUrl}
            <img src={m.user.avatarUrl} alt={m.user.name ?? m.user.githubUsername ?? m.user.email ?? ''} class="h-5 w-5 rounded-full" />
          {/if}
          <span class="text-zinc-700 dark:text-zinc-300">{m.user.name ?? m.user.githubUsername ?? m.user.email}</span>
          {#if m.role === 'OWNER'}
            <span class="rounded-full bg-indigo-100 px-1.5 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300">Owner</span>
          {:else}
            <span class="text-xs text-zinc-500">{m.role}</span>
          {/if}
        </div>
      {/each}
    </div>
  </section>

  <!-- Memories -->
  <section>
    <div class="mb-3 flex items-center justify-between">
      <h2 class="font-semibold text-zinc-900 dark:text-white">Memories <span class="ml-1 text-sm font-normal text-zinc-500">({org.memories?.length ?? 0})</span></h2>
      <a href="/app/orgs/{org.id}/memories" class="text-sm text-indigo-600 hover:underline dark:text-indigo-400">Manage →</a>
    </div>
    {#if !org.memories?.length}
      <p class="text-sm text-zinc-500">No memories yet.</p>
    {:else}
      <div class="grid gap-3 sm:grid-cols-2">
        {#each org.memories as g (g.id)}
          <div class="rounded-xl border border-zinc-200 bg-white p-4 transition hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600">
            <div class="flex items-center justify-between">
              <a href="/app/orgs/{org.id}/memories/{g.id}/browse" class="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-300">{g.name}</a>
              <span class="rounded px-1.5 py-0.5 text-xs {g.visibility === 'PUBLIC' ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'}">{g.visibility}</span>
            </div>
            <CopyUrn value={g.urn} size={10} />
            {#if g.lastSyncedAt}
              <p class="mt-1 text-xs text-zinc-500">Synced {new Date(g.lastSyncedAt).toLocaleDateString()}</p>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </section>

  <!-- Agents -->
  <section>
    <div class="mb-3 flex items-center justify-between">
      <h2 class="font-semibold text-zinc-900 dark:text-white">Agents <span class="ml-1 text-sm font-normal text-zinc-500">({org.agents?.length ?? 0})</span></h2>
      <a href="/app/orgs/{org.id}/agents" class="text-sm text-indigo-600 hover:underline dark:text-indigo-400">Manage →</a>
    </div>
    {#if !org.agents?.length}
      <p class="text-sm text-zinc-500">No agents yet.</p>
    {:else}
      <div class="grid gap-3 sm:grid-cols-2">
        {#each org.agents as a (a.id)}
          <div class="rounded-xl border border-zinc-200 bg-white p-4 transition hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600">
            <a href="/app/orgs/{org.id}/agents" class="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-300">{a.name}</a>
            <CopyUrn value={a.urn} size={10} />
            {#if a.description}
              <p class="mt-1 text-xs text-zinc-500">{a.description}</p>
            {/if}
            <p class="mt-1 text-xs text-zinc-400">{a.memoryItems.length} memor{a.memoryItems.length !== 1 ? 'ies' : 'y'}</p>
          </div>
        {/each}
      </div>
    {/if}
  </section>

  <!-- Integrations -->
  <section>
    <h2 class="mb-3 font-semibold text-zinc-900 dark:text-white">Integrations</h2>

    {#if form?.error}
      <div class="mb-3 rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{form.error}</div>
    {/if}
    {#if form?.githubLinked}
      <div class="mb-3 rounded-lg border border-green-800 bg-green-950 px-4 py-3 text-sm text-green-300">GitHub App installation linked.</div>
    {/if}
    {#if form?.githubAppSaved}
      <div class="mb-3 rounded-lg border border-green-800 bg-green-950 px-4 py-3 text-sm text-green-300">GitHub App credentials saved.</div>
    {/if}
    {#if form?.githubUnlinked}
      <div class="mb-3 rounded-lg border border-green-800 bg-green-950 px-4 py-3 text-sm text-green-300">GitHub App disconnected.</div>
    {/if}
    {#if justInstalled}
      <div class="mb-3 rounded-lg border border-green-800 bg-green-950 px-4 py-3 text-sm text-green-300">Hadron GitHub App installed and linked to this organization.</div>
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
            <form method="POST" action="?/unlinkGithub" use:scrollEnhance
              onsubmit={(e) => { if (!confirm('Disconnect GitHub? This removes the installation ID and any stored credentials.')) e.preventDefault(); }}
            >
              <button type="submit" class="rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950">Disconnect</button>
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
      </select>
      <button
        onclick={() => { showGithubConfig = true; }}
        disabled={!selectedIntegration}
        class="rounded-lg px-4 py-1.5 text-sm font-medium transition
          {selectedIntegration
            ? 'bg-indigo-600 text-white hover:bg-indigo-500'
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
  </section>

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
          <form method="POST" action="?/updateGithubApp" use:scrollEnhance class="max-w-lg space-y-3">
            <div>
              <label for="appId" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">App ID</label>
              <input id="appId" name="appId" type="text" required
                value={org.githubAppId ?? ''}
                placeholder="e.g. 123456"
                class="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none" />
            </div>
            <div>
              <label for="privateKey" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">Private Key (PEM)</label>
              <textarea id="privateKey" name="privateKey" required rows="6"
                placeholder="-----BEGIN RSA PRIVATE KEY-----&#10;...&#10;-----END RSA PRIVATE KEY-----"
                class="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-xs text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"></textarea>
              <p class="mt-1 text-xs text-zinc-500">Encrypted at rest. Never displayed after saving.</p>
            </div>
            <button type="submit" class="rounded-lg bg-zinc-200 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-300 dark:bg-zinc-700 dark:text-white dark:hover:bg-zinc-600">
              {org.githubAppId ? 'Update Credentials' : 'Save Credentials'}
            </button>
          </form>
        </div>

        <!-- Installation ID -->
        <div>
          <h3 class="mb-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">Installation ID</h3>
          {#if org.githubInstallationId}
            <p class="mb-3 text-sm text-zinc-600 dark:text-zinc-400">Current: <code class="font-mono text-zinc-900 dark:text-zinc-200">{org.githubInstallationId}</code></p>
          {/if}
          <form method="POST" action="?/linkGithub" use:scrollEnhance class="flex items-end gap-3 max-w-md">
            <div class="flex-1">
              <label for="installationId" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">Installation ID</label>
              <input id="installationId" name="installationId" type="number" required
                value={org.githubInstallationId ?? ''}
                placeholder="e.g. 12345678"
                class="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none" />
            </div>
            <button type="submit" class="rounded-lg bg-zinc-200 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-300 dark:bg-zinc-700 dark:text-white dark:hover:bg-zinc-600">
              {org.githubInstallationId ? 'Update' : 'Save'}
            </button>
          </form>
        </div>
      </div>
    {/if}
  {/snippet}

  <!-- Subscriptions -->
  {#if org.subscriptions?.length}
    <section>
      <h2 class="mb-3 font-semibold text-zinc-900 dark:text-white">Subscribed memories <span class="ml-1 text-sm font-normal text-zinc-500">({org.subscriptions.length})</span></h2>
      <div class="grid gap-3 sm:grid-cols-2">
        {#each org.subscriptions as s (s.id)}
          <div class="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <p class="text-sm font-medium text-indigo-600 dark:text-indigo-300">{s.memory.name}</p>
            <CopyUrn value={s.memory.urn} size={10} />
            <p class="mt-1 text-xs text-zinc-500">Role: {s.role}</p>
          </div>
        {/each}
      </div>
    </section>
  {/if}
</div>
