<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { page } from '$app/stores';
  import { onDestroy } from 'svelte';
  import ErrorPage from '$lib/components/ErrorPage.svelte';
  import { t } from '$lib/i18n/t';

  let retrying = $state(false);
  let retryFailed = $state(false);
  let destroyed = false;
  onDestroy(() => { destroyed = true; });

  async function retry(event: MouseEvent) {
    // Client routing must really re-read; without JS the same link falls back
    // to a full document GET rather than reusing the failed load.
    event.preventDefault();
    if (retrying) return;
    retrying = true;
    retryFailed = false;
    try {
      await invalidateAll();
      // A resolved invalidation can still render the SAME error constructor:
      // the query failed again. Success destroys this page; if we are still
      // here, re-arm Retry instead of leaving it disabled forever.
      if (!destroyed) {
        retryFailed = true;
        retrying = false;
      }
    } catch {
      // Keep the current error page usable when the retry itself is offline.
      // The native link remains available; no rejected promise escapes.
      retryFailed = true;
      retrying = false;
    }
  }
</script>

<ErrorPage
  homeHref="/app/dashboard"
  homeLabel={t('public-organization.error.back', 'Back to dashboard')}
>
  {#if $page.status !== 404}
    <div class="mt-5">
      <a
        href="{$page.url.pathname}{$page.url.search}"
        data-sveltekit-reload
        aria-disabled={retrying}
        class="inline-flex rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 aria-disabled:cursor-wait aria-disabled:opacity-50"
        onclick={retry}
      >{retrying ? t('public-organization.error.retrying', 'Retrying…') : t('public-organization.error.retry', 'Retry')}</a>
      {#if retryFailed}
        <p role="alert" class="mt-3 text-sm text-red-700 dark:text-red-300">
          {t('public-organization.error.retry-failed', 'Retry failed. Check your connection and try again.')}
        </p>
      {/if}
    </div>
  {/if}
</ErrorPage>
