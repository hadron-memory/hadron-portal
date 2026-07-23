<script lang="ts">
  import { page } from '$app/stores';
  import { t } from '$lib/i18n/t';

  // #567 — the styled error surface rendered by the `+error.svelte`
  // boundaries. Replaces SvelteKit's unstyled default page for thrown
  // `error(...)`s (e.g. the /app/u/[urn] resolver's not-found). Reads
  // status + message from the page store; the boundary only picks the
  // "go home" target for its layout depth.
  let {
    homeHref = '/',
    homeLabel = t('app.error.home', 'Go home'),
  }: { homeHref?: string; homeLabel?: string } = $props();

  const title = $derived.by(() => {
    switch ($page.status) {
      case 400:
        return t('app.error.400', 'That request didn’t look right');
      case 403:
        return t('app.error.403', 'No access');
      case 404:
        return t('app.error.404', 'Nothing found here');
      default:
        return t('app.error.generic', 'Something went wrong');
    }
  });
</script>

<div class="flex min-h-[60vh] items-center justify-center px-6 py-16">
  <div class="w-full max-w-lg text-center">
    <p class="text-sm font-semibold tracking-widest text-zinc-400 dark:text-zinc-500">
      {$page.status}
    </p>
    <h1 class="mt-2 text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
      {title}
    </h1>
    {#if $page.error?.message}
      <p class="mt-3 break-words text-sm text-zinc-600 dark:text-zinc-400">
        {$page.error.message}
      </p>
    {/if}
    <div class="mt-8 flex items-center justify-center gap-3">
      <button
        type="button"
        onclick={() => history.back()}
        class="rounded-md border border-zinc-300 px-4 py-1.5 text-sm text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        {t('app.error.back', 'Go back')}
      </button>
      <a
        href={homeHref}
        class="rounded-md bg-blue-600 px-4 py-1.5 text-sm text-white transition hover:bg-blue-500"
      >
        {homeLabel}
      </a>
    </div>
  </div>
</div>
