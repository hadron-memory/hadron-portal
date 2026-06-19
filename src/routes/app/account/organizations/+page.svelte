<script lang="ts">
  // #327 follow-up: the Organizations section moved off the Account tab into its
  // own "Organization" tab. Static links — org membership management lives under
  // /app/orgs. Reachable here from consumer-mode accounts with no left-menu org
  // section (spec 014 FR-010 + FR-012).
  import { t } from '$lib/i18n/t';
</script>

<svelte:head><title>Organization · Hadron</title></svelte:head>

<div class="max-w-lg space-y-4">
  <div>
    <h2 class="font-semibold text-zinc-900 dark:text-white">{t('app.account.orgs.heading', 'Organizations')}</h2>
    <p class="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{t('app.account.orgs.subtitle', 'Manage memberships or create a new organization.')}</p>
  </div>
  <div class="flex gap-3">
    <a href="/app/orgs/" class="inline-block rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
      {t('app.account.orgs.view', 'View organizations')}
    </a>
    <a href="/app/orgs/new" class="inline-block rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600">
      {t('app.account.orgs.create', 'Create organization')}
    </a>
  </div>
</div>
