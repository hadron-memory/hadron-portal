<script lang="ts">
  // #626: new-user landing. The server's /auth/session hands a freshly-signed-up
  // user `redirect: '/app/setup'`; before this route existed that 303 hit a 404.
  // This is a lightweight first-run welcome — it reads the /app layout data
  // (user + resolved active org) and links to existing routes, so it stays
  // correct as onboarding evolves (#627/#629).
  import { t } from '$lib/i18n/t';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const displayName = $derived(data.user?.name ?? (data.user?.handle ? `@${data.user.handle}` : null));
  // Memory creation is org-scoped; a brand-new user always has at least their
  // own (personal) org resolved by the layout. Guarded so the card hides rather
  // than links to a broken `/app/orgs//…` if no org resolved.
  const createMemoryHref = $derived(
    data.activeOrgId ? `/app/orgs/${data.activeOrgId}/memories/new` : null,
  );
  const workspaceHref = $derived(
    data.activeOrgId ? `/app/orgs/${data.activeOrgId}` : '/app/marketplace',
  );
</script>

<svelte:head><title>{t('setup.title', 'Welcome — Hadron')}</title></svelte:head>

<div class="mx-auto max-w-2xl space-y-8 py-8">
  <div>
    <h1 class="text-2xl font-bold text-zinc-900 dark:text-white">
      {#if displayName}
        {t('setup.heading-named', 'Welcome to Hadron, {name}').replace('{name}', displayName)}
      {:else}
        {t('setup.heading', 'Welcome to Hadron')}
      {/if}
    </h1>
    <p class="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
      {t(
        'setup.intro',
        'Hadron is your knowledge memory — a graph of notes, tasks, and context that you and your AI agents can read and write. Here are a couple of ways to get started.',
      )}
    </p>
  </div>

  <div class="grid gap-4 sm:grid-cols-2">
    {#if createMemoryHref}
      <a
        href={createMemoryHref}
        class="group rounded-xl border border-zinc-200 bg-white p-5 transition hover:border-indigo-300 hover:shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-indigo-700"
      >
        <div class="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-300">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
        </div>
        <h2 class="font-semibold text-zinc-900 group-hover:text-indigo-600 dark:text-white dark:group-hover:text-indigo-300">
          {t('setup.create-memory.title', 'Create your first memory')}
        </h2>
        <p class="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          {t('setup.create-memory.desc', 'Start a memory to capture notes and context you can grow over time.')}
        </p>
      </a>
    {/if}

    <a
      href="/app/marketplace"
      class="group rounded-xl border border-zinc-200 bg-white p-5 transition hover:border-indigo-300 hover:shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-indigo-700"
    >
      <div class="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-300">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 3h18v4H3zM3 10h18v11H3zM8 14h8"/></svg>
      </div>
      <h2 class="font-semibold text-zinc-900 group-hover:text-indigo-600 dark:text-white dark:group-hover:text-indigo-300">
        {t('setup.marketplace.title', 'Explore the marketplace')}
      </h2>
      <p class="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        {t('setup.marketplace.desc', 'Discover agents you can subscribe to and put to work on your memories.')}
      </p>
    </a>
  </div>

  <div>
    <a href={workspaceHref} class="text-sm font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400">
      {t('setup.skip', 'Skip for now — go to your workspace')} &rarr;
    </a>
  </div>
</div>
